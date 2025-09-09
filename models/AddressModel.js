import express from 'express';
import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
    userId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    addresses: [
        {
            name: {
                type: String,
                required: true,
                trim: true
            },
            phone: {
                type: Number,
                required: true
            },
            addressLine1:{
                type: String,
                required: true,
                trim: true
            },
            addressLine2:{
                type: String,
                trim: true
            },
            city:{
                type: String,
                required: true,
                trim: true
            },
            pinCode:{
                type: String,
                required: true,
                trim: true
            },
            state:{
                type: String,
                required: true,
                trim: true
            }
        }
    ]
});

const Address = mongoose.model("Address",addressSchema);
export default Address;