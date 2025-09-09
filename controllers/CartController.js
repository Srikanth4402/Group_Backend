import express from 'express';
import Cart from '../models/CartModel.js';
import mongoose from 'mongoose';

export const addToCartNotWorking = async (req,res) => {
    try {
        const { userId, userName, items } = req.body;
        const { productId, title, price, quantity, img } = items[0];

        const cart = await Cart.findOne({ userId });

        if (cart) {
            cart.items = cart.items || [];
            const itemIndex = cart.items.findIndex(
                (item) => item.productId.toString() === productId
            );

            if (itemIndex > -1) {
                cart.items[itemIndex].quantity += 1;
            } else {
                cart.items.push({
                    productId: new mongoose.Types.ObjectId(productId),
                    quantity, price, title, img
                });
            }

            await cart.save();
            return res.status(200).json({ message: "Item added to the cart", cart });
        } else {
            const newCart = new Cart({
                userId,
                userName,
                items: [{
                    productId: new mongoose.Types.ObjectId(productId),
                    quantity, price, title, img
                }]
            });
            await newCart.save();
            return res.status(200).json({ message: "Cart created for the user and product is added", cart: newCart });
        }
    } catch (error) {
        return res.status(500).json({ message: "Error adding to cart", error: error.message });
    }
};

export const addToCart = async (req, res) => {
    try {
        const { items } = req.body;
        const userId = req.user._id; 
        console.log(`${userId} userId from the token in add to cart`);

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "Items array is missing or empty." });
        }

        const { productId, title, price, quantityDelta, img } = items[0];

        if (!userId || !productId || !title || price === undefined || quantityDelta === undefined || !img) {
            return res.status(400).json({ message: "Missing required fields for cart operation." });
        }

        const productObjectId = new mongoose.Types.ObjectId(productId);
        let cart = await Cart.findOne({ userId });

        if (cart) {
            cart.items = cart.items || [];
            const itemIndex = cart.items.findIndex(
                (item) => item.productId.toString() === productObjectId.toString()
            );

            if (itemIndex > -1) {
                cart.items[itemIndex].quantity += quantityDelta;
                if (cart.items[itemIndex].quantity <= 0) {
                    cart.items.splice(itemIndex, 1);
                }
            } else {
                if (quantityDelta > 0) {
                    cart.items.push({
                        productId: productObjectId,
                        quantity: quantityDelta,
                        price,
                        title,
                        img,
                    });
                }
            }

            await cart.save();
            return res.status(200).json({ message: "Cart updated successfully", cart });
        } else {
            if (quantityDelta > 0) {
                const newCart = new Cart({
                    userId,
                    items: [{ productId: productObjectId, quantity: quantityDelta, price, title, img }],
                });
                await newCart.save();
                return res.status(201).json({ message: "Cart created and product added", cart: newCart });
            } else {
                return res.status(404).json({ message: "Cart not found for user, cannot decrease quantity." });
            }
        }
    } catch (error) {
        console.error("Error in addToCart controller:", error);
        return res.status(500).json({ message: "Error adding/updating item in cart", error: error.message });
    }
};

export const removeFromCart = async (req, res) => {
    try {
        const { userId, productId } = req.params;
        const cart = await Cart.findOne({ userId });

        if (!cart) {
            return res.status(404).json({ message: "Cart not found" });
        }

        // Filter out the product to be removed
        cart.items = cart.items.filter(
            (item) => item.productId.toString() !== productId
        );

        // If no items left, delete the whole cart
        if (cart.items.length === 0) {
            await Cart.deleteOne({ userId });
            return res.status(200).json({ message: "Cart deleted because no items left" });
        }

        // Otherwise, save the updated cart
        await cart.save();
        return res.status(200).json({ message: "Item removed from cart", cart });

    } catch (error) {
        console.error("Error removing item from cart:", error);
        return res.status(500).json({ 
            message: "Error removing item from cart", 
            error: error.message 
        });
    }
};


export const getCartItems = async (req,res) => {
    try {
        const userId = req.user.id;        
        const cart = await Cart.findOne({ userId });

        if (!cart) {
            return res.status(200).json({ message : "Cart not found for the user because cart is empty", cart: { items: [] } });
        }

        return res.status(200).json({ cart });
    } catch (error) {
        console.log("Error getting cart items", error);
        return res.status(500).json({ message: "Error getting cart items", error: error.message });
    }
};

export const deleteAfterOrdering = async (req,res) => {
    try {
        const { userId } = req.params;
        const deletedCart = await Cart.findOneAndDelete({ userId });

        if (!deletedCart) {
            return res.status(404).json({ message: "Cart not found for the user" });
        }

        console.log("Cart deleted after ordering");
        return res.status(200).json({ message: "Cart deleted after ordering", deletedCart });
    } catch (error) {
        console.log("Error deleting cart after ordering", error);
        return res.status(500).json({ message: "Error deleting cart after ordering", error: error.message });
    }
};
