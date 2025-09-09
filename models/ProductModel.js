import express from 'express';
import mongoose from 'mongoose';

const ProductsSchema = new mongoose.Schema({
    title:{
        type: String,
        required: true,
        trim: true
    },
    category:{
        type: String,
        required: true,
        trim: true
    },
    newPrice:{
        type: Number,
        required: true
    },
    prevPrice:{
        type: Number,
        required: true
    },
    img:{
        type:String,
        required: true
    },
    subCategory:{
        type: String,
        required: true
    },
    company:{
        type: String,
        required: true
    },
    color:{
        type:String,
        required: true
    }

})

const Product = mongoose.model("Product",ProductsSchema);
export default Product;