import WishList from "../models/WishListModel.js";
import Product from "../models/ProductModel.js";
import mongoose from 'mongoose'; // <-- ADD THIS LINE!

const PRODUCT_FIELDS_TO_POPULATE = 'img title newPrice prevPrice category _id';

export const getWishlist = async (req, res, next) => {
    try {
        const userId = req.user.id;
        let wishlist = await WishList.findOne({ userId }).populate('products', PRODUCT_FIELDS_TO_POPULATE);

        if (!wishlist) {
            // Note: If you create a new wishlist here, you should also convert productId to ObjectId
            // However, this `getWishlist` function is for fetching, not adding.
            // So, simply creating an empty wishlist is usually fine.
            wishlist = await WishList.create({ userId, products: [] });
            wishlist = await WishList.findById(wishlist._id).populate('products', PRODUCT_FIELDS_TO_POPULATE);
        }

        res.status(200).json({wishlist: wishlist.products});
    } catch (error) {
        console.error("Error in getWishlist:", error);
        next(error);
    }
};

export const addProductToWishlist = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const { productId } = req.params;

        const productExists = await Product.findById(productId);
        if (!productExists) {
            res.status(404);
            throw new Error('Product not found for the given ID');
        }

        let wishlist = await WishList.findOne({ userId });

        if (!wishlist) {
            // Corrected line with mongoose imported
            wishlist = await WishList.create({ userId, products: [new mongoose.Types.ObjectId(productId)] });
            // Populate the new wishlist before sending it in the response
            wishlist = await WishList.findById(wishlist._id).populate('products', PRODUCT_FIELDS_TO_POPULATE);
            return res.status(201).json({ message: "New wishlist created successfully and product added to wishlist", products: wishlist.products }); // Return products array
        } else {
            // Check if product already exists (compare ObjectId with string productId)
            // It's safer to convert `productId` to ObjectId for consistent comparison if `wishlist.products` stores ObjectIds
            if (wishlist.products.some(id => id.toString() === productId)) {
                 res.status(409);
                 throw new Error('Product already exists in the wishlist!');
            }
            wishlist.products.push(new mongoose.Types.ObjectId(productId)); // Ensure consistency, push ObjectId
            await wishlist.save();
        }

        wishlist = await WishList.findById(wishlist._id).populate('products', PRODUCT_FIELDS_TO_POPULATE);
        res.status(200).json(wishlist);
    } catch (error) {
        console.error("Error in addProductToWishlist:", error);
        const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
        res.status(statusCode).json({
            message: error.message || 'Failed to add product to wishlist',
            stack: process.env.NODE_ENV === 'production' ? null : error.stack
        });
    }
};

export const removeProductFromWishlist = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { productId } = req.params;

        let wishlist = await WishList.findOne({ userId });

        if (!wishlist) {
            res.status(404);
            throw new Error('Wishlist not found for this user.');
        }

        const initialLength = wishlist.products.length;
        wishlist.products = wishlist.products.filter(
            (id) => id.toString() !== productId // This comparison is good
        );

        if (wishlist.products.length === initialLength) {
            res.status(404);
            throw new Error('Product not found in wishlist.');
        }

        await wishlist.save();

        wishlist = await WishList.findById(wishlist._id).populate('products', PRODUCT_FIELDS_TO_POPULATE);
        res.status(200).json(wishlist);
    } catch (error) {
        console.error("Error in removeProductFromWishlist:", error);
        const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
        res.status(statusCode).json({
            message: error.message || 'Failed to remove product from wishlist',
            stack: process.env.NODE_ENV === 'production' ? null : error.stack
        });
    }
};