import Address from "../models/AddressModel.js";
export const getUserAddresses = async (req,res) => {
    try {
        const { userId } = req.params;
        const userAddresses = await Address.findOne({userId});
        if(!userAddresses){
            return res.status(201).json({message: "Address for this userId not found", addresses: []});
        }
        // console.log("Addresses", userAddresses.addresses);
        return res.status(200).json({message: "Addresses of user fetched successfully", addresses: userAddresses.addresses});
    } catch (error) {
        console.log("Error while getting user addresses",error);
        return res.status(500).json({message: "Error while getting user addresses"});
    }
}


export const addUserAddress = async (req, res) => {
    try {
        const { userId } = req.params; // Extract userId from the request params
        const { name, phone, addressLine1, addressLine2, city, pinCode, state } = req.body;

        // Validate required fields
        if (!name || !phone || !addressLine1 || !city || !pinCode || !state) {
            return res.status(400).json({
                message: "Missing required address fields (name, phone, addressLine1, city, pinCode, state).",
            });
        }

        // Check if the user already has an address document
        const userAddresses = await Address.findOne({ userId });

        if (!userAddresses) {
            // Create a new Address document for the user
            const newDocument = await Address.create({
                userId, // Explicitly set the userId
                addresses: [
                    {
                        name,
                        phone,
                        addressLine1,
                        addressLine2: addressLine2 || "", // Optional field
                        city,
                        pinCode,
                        state,
                    },
                ],
            });

            // console.log("New address document created:", newDocument);
            return res.status(201).json({
                message: "New document created and address added successfully.",
                addresses: newDocument.addresses,
            });
        }

        // Create the new address object to be added to the existing document
        const newAddress = {
            name,
            phone,
            addressLine1,
            addressLine2: addressLine2 || "", // Optional field
            city,
            pinCode,
            state,
        };

        // Add the new address to the existing document
        const updatedAddressDocument = await Address.findOneAndUpdate(
            { userId }, // Query: find document by userId
            { $push: { addresses: newAddress } }, // Update: push newAddress into the 'addresses' array
            { new: true, upsert: true, runValidators: true } // Options: return updated doc, create if not exists, run schema validators
        );

        // console.log("Address added successfully:", updatedAddressDocument.addresses);
        return res.status(201).json({
            message: "Address added successfully.",
            addresses: updatedAddressDocument.addresses,
        });
    } catch (error) {
        console.error("Error while adding user address:", error);
        return res.status(500).json({
            message: "Error while adding user address.",
            error: error.message,
        });
    }
};