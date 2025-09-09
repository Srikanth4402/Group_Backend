import express from 'express';
import mongoose from 'mongoose';

const wishListSchema = new mongoose.Schema({
    userId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    products : [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        }
    ]
},{timestamps : true});

const WishList = mongoose.model("WishList",wishListSchema);
export default WishList;

