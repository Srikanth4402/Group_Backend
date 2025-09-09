import Product from "../models/ProductModel.js";
import mongoose from "mongoose";

export const createProduct = async (req,res) => {
    try {
            const product = await Product.create(req.body);
            if(!product){
              return res.status(400).json({message: "Error creating product, please try again"});
            }
            console.log("Product created successfully");
            return res.status(200).json({message: "Product created successfully"});
        } catch (error) {
            console.log(error,error.message);
            res.status(500).json({message: "Error adding data",error});  
        }
}

export const getProducts = async (req, res) => {
    try {
      const { category, subCategory, minPrice, maxPrice } = req.query;
      const filter = {};

      if (subCategory && !category) {
        return res.status(400).json({
          message: 'Filtering by subCategory requires a "category" query parameter to be specified.',
          example: '/api/products?category=electronics&subCategory=mobiles'
        });
      }
  
      if (category) {
        filter.category = new RegExp(category, 'i');
      }
  
      if (subCategory) {
        filter.subCategory = new RegExp(subCategory, 'i');
      }
  
      if (minPrice || maxPrice) {
        filter.newPrice = {};
  
        if (minPrice) {
          filter.newPrice.$gte = parseFloat(minPrice);
        }
        if (maxPrice) {
          filter.newPrice.$lte = parseFloat(maxPrice);
        }
      }
  
      const products = await Product.find(filter);
      console.log("products fetched successfully");
      res.status(200).json(products);
    } catch (error) {
      console.error('Error fetching products:', error);
      res.status(500).json({ message: 'Server Error', error: error.message });
    }
  };

export const getProduct = async (req,res) => {
    try {
        const { id } = req.params;
        const product = await Product.findById(id);
        if(!product){
            res.send("Produt not found for this Id");
        }
        console.log("Product");
        return res.status(200).json({message: "product fetched successfully", product});
    } catch (error) {
        console.log("Error occured", error, error.message);
        res.status(404).json({message: "Product not found for the Id"});
    }
}

export const deleteProduct = async (req,res, next) => {
    try {
        const { id } = req.params;
        const deletedProduct = await Product.findByIdAndDelete(id);
        console.log("Product deleted successfully")
        return res.status(200).json({message: "deleted successfully"});

    } catch (error) {
       res.status(404).json({message: "Error deleting product"}) 
       console.error(error);
    }
}

export const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ message: "Product ID is required" });
        }
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid product ID format" });
        }
        const { title, category, color, prevPrice, newPrice, img, subCategory, company } = req.body;

        // Find the product by ID and update it
        const updatedProduct = await Product.findByIdAndUpdate(
            id,
            {
                title,
                category,
                color,
                prevPrice,
                newPrice,
                img,
                subCategory,
                company,
            },
            { new: true, runValidators: true } // Return the updated document and validate the fields
        );

        if (!updatedProduct) {
            return res.status(404).json({ message: "Product not found for the given ID" });
        }

        console.log("Product updated successfully");
        res.status(200).json({ message: "Product updated successfully", product: updatedProduct });
    } catch (error) {
        console.error("Error updating product:", error);
        res.status(500).json({ message: "Error updating product", error: error.message });
    }
};

export const searchProducts = async (req,res) => {
    try{
        const searchQuery = req.query.query;
        if(!searchQuery){
            return res.status(400).json({message: "search query parameter required"});
        }
        const lowerCaseQuery =  searchQuery.toLowerCase();
        const products = await Product.find({
            $or: [
                {title: { $regex: new RegExp(lowerCaseQuery,'i')}},
                {category: { $regex: new RegExp(lowerCaseQuery, 'i')}},
                {subCategory: { $exists: true, $regex: new RegExp(lowerCaseQuery,'i')}}
            ]
        });
            res.status(200).json(products);
            // console.log("Successful" , products)
 
       
    }
    catch (error) {
        console.log("Error", error,error.message);
        res.status(500).json({message: error.message});
    }
}

export const getImageUrl = async (req, res) => {
  try {
    const { orderProductId } = req.params;
    if (!orderProductId) {
      return res.status(400).json({ message: "Order product ID is required" });
    }
    const product = await Product.findById(orderProductId);
    // console.log(product);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    const imageUrl = product.img;
    if (!imageUrl) {
      return res.status(404).json({ message: "Image URL not found for this product" });
    }
    return res.status(200).json({ imageUrl: imageUrl });
  } catch (error) {
    console.error("Error fetching image URL:", error);
    res.status(500).json({ message: "Error fetching image URL", error: error.message });
  }
}

export const getAllProducts = async (req, res) => {
    try {
        const products = await Product.find({});
        if(products.length===0){
            return res.status(200).json({ message: "No products found", products: [] });
        }
        if (!products || products.length === 0) {
            return res.status(404).json({ message: "No products found" });
        }
        console.log("All Products fetched successfully");
        return res.status(200).json({ message: "Products fetched successfully", products: products });
    } catch (error) {
        console.error("Error fetching all products:", error);
        return res.status(500).json({ message: "Error fetching all products", error: error.message });
    }
}

// 🔥 Only updated function
export const bulkCreateProducts = async (req, res) => {
    try {
        const products = req.body;

        if (!Array.isArray(products) || products.length === 0) {
            return res.status(400).json({ message: "Invalid product data. Expected an array of products." });
        }

        const createdProducts = await Product.insertMany(products, { ordered: false });

        return res.status(201).json({
            message: "Products created successfully",
            count: createdProducts.length,
            products: createdProducts
        });
    } catch (error) {
        console.error("Error creating products:", error);
        return res.status(500).json({ message: "Error creating products", error: error.message });
    }
};
