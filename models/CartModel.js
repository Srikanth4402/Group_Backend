import express from 'express';
import mongoose from 'mongoose';

const cartSchema = new mongoose.Schema({
    userId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // userName:{
    //     type: String,
    //     required: true,
    //     trim: true
    // },
    items:[
        {
            productId:{
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Product',
                required: true
            },
            quantity:{
                type: Number,
                required: true,
                min: 1,
                default: 1,
            },
            price:{
                type: Number,
                required: true
            },
            title:{
                type: String,
                required: true
            },
            img:{
                type: String,
                required: true
            }
        }
    ]
},{timestamps : true});

const Cart = mongoose.model("Cart",cartSchema);
export default Cart;

