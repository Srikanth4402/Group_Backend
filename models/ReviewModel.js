import express from 'express';
import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
    productId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    reviews:[
        {
            userId:{
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
                required: true
            },
            userName: {
                type: String,
                required: true,
                trim: true
            },
            review:{
                type: String,
                required: true,
                trim: true
            },
            rating:{
                type:Number,
                required: false
            },
            reviewDate: { // Date the order was placed
                type: Date,
                default: Date.now,
                required: false
              },

        }
    ]
},{timestamps: true})

const Review = mongoose.model("Review",reviewSchema);

export default Review;