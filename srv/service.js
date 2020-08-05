

module.exports = async srv => {
  const {BusinessPartnerAddress, Notifications, Addresses, BusinessPartner} = srv.entities;
  const bupaSrv = await cds.connect.to("API_BUSINESS_PARTNER");
  const {postcodeValidator} = require('postcode-validator');
  
  srv.on("READ", BusinessPartnerAddress, req => bupaSrv.tx(req).run(req.query))
  srv.on("READ", BusinessPartner, req => bupaSrv.tx(req).run(req.query))

  bupaSrv.on("BusinessPartner/Created", async msg => {
    console.log("<< event caught", msg);
    const BUSINESSPARTNER = (+(msg.data.KEY[0].BUSINESSPARTNER)).toString();
    // ID has prefix 000 needs to be removed to read address
    console.log(BUSINESSPARTNER);
    const bpEntity = await bupaSrv.tx(msg).run(SELECT.one(BusinessPartner).where({businessPartnerId: BUSINESSPARTNER}));
    const result = await cds.tx(msg).run(INSERT.into(Notifications).entries({businessPartnerId:BUSINESSPARTNER, verificationStatus_code:'N', businessPartnerName:bpEntity.businessPartnerName}));
    const address = await bupaSrv.tx(msg).run(SELECT.one(BusinessPartnerAddress).where({businessPartnerId: BUSINESSPARTNER}));
    // for the address to notification association - extra field
    const notificationObj = await cds.tx(msg).run(SELECT.one(Notifications).columns("ID").where({businessPartnerId: BUSINESSPARTNER}));
    address.notifications_id=notificationObj.ID;
    const res = await cds.tx(msg).run(INSERT.into(Addresses).entries(address));
    console.log("Address inserted", result);

  });

  bupaSrv.on("BusinessPartner/Changed", async msg => {
    console.log("<< event caught", msg);
    const BUSINESSPARTNER = (+(msg.data.KEY[0].BUSINESSPARTNER)).toString();
    const bpIsAlive = await cds.tx(msg).run(SELECT.one(Notifications, (n) => n.verificationStatus_code).where({businessPartnerId: BUSINESSPARTNER}));
    if(bpIsAlive.verificationStatus_code == "P"){
      const bpMarkVerified= await cds.tx(msg).run(UPDATE(Notifications).where({businessPartnerId: BUSINESSPARTNER}).set({verificationStatus_code:"V"}));
    }    
    console.log("<< BP marked verified >>")
  });

  srv.after("UPDATE", "Notifications", data => {
    console.log("Notification update", data.businessPartnerId);
    if(data.verificationStatus_code === "P" || data.verificationStatus_code === "INV")
    emitEvent(data);
  });

  srv.before("SAVE", "Notifications", req => {
    if(req.data.verificationStatus_code == "V"){
      req.error({code: '400', message: "Cannot mark as VERIFIED. Please change to PROCESS", numericSeverity:2, target: 'verificationStatus_code'});
    }
  });

  srv.before("PATCH", "Addresses", req => {
    // To set whether address is Edited
    req.data.isModified = true;
  });

  srv.after("PATCH", "Addresses", (data, req) => {
    const isValidPinCode = postcodeValidator(data.postalCode, data.country);
    if(!isValidPinCode){
      return req.error({code: '400', message: "invalid postal code", numericSeverity:2, target: 'postalCode'});
    } 
    return req.info({numericSeverity:1, target: 'postalCode'});  
  });

  function emitEvent(result){
    // const result =  await cds.run(SELECT.one.from("my.businessPartnerValidation.Notification as N").leftJoin("my.businessPartnerValidation.Address as A").on({"N.businessPartnerId":"A.businessPartnerId"}).where("N.businessPartnerId", bp));
    const statusValues={"N":"NEW", "P":"PROCESS", "INV":"INVALID", "V":"VERIFIED"}
    // Format JSON as per serverless requires
    const payload = {
      "businessPartner": result.businessPartnerId,
      "businessPartnerName": result.businessPartnerName,
      "verificationStatus": statusValues[result.verificationStatus_code],
      "addressId": result.addresses[0].addressId,
      "streetName": result.addresses[0].streetName,
      "postalCode": result.addresses[0].postalCode,
      "country": result.addresses[0].country,
      "addressModified": result.addresses[0].isModified
    }
    
    console.log("<< data to serverless >>>", result);
    console.log("<< formatted >>>>>", payload);
    srv.emit("BusinessPartnerVerified", payload);
  }

  
}
