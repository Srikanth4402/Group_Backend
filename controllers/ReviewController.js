import mongoose from "mongoose";
import Review from "../models/ReviewModel.js";

export const addReview = async (req, res) => {
    try {
        const { productId } = req.params;
        if( !productId ) {
            return res.status(400).json({ message: "Product ID is required." });
        }
        const { review, rating, userName } = req.body; // Extract userName from the request body
        const userId = req.user._id; // Get userId from req.user (populated by AuthMiddleware)
        // console.log(productId, review, userName);
        // Validate required fields
        if (!productId || !review || !userName) {
            return res.status(400).json({ message: "Product ID, review text, and user name are required." });
        }

        // Check if reviews already exist for the product
        const existingProductReviews = await Review.findOne({ productId });

        if (existingProductReviews) {
            // Check if the user has already reviewed this product
            const userReviewIndex = existingProductReviews.reviews.findIndex(
                (review) => review.userId.toString() === userId.toString()
            );

            if (userReviewIndex > -1) {
                // User has already reviewed this product, update the review
                existingProductReviews.reviews[userReviewIndex].review = review;
                existingProductReviews.reviews[userReviewIndex].rating = rating || null; // Rating is optional
                existingProductReviews.reviews[userReviewIndex].userName = userName; // Update userName
                existingProductReviews.reviews[userReviewIndex].reviewDate = existingProductReviews.reviews[userReviewIndex].reviewDate || new Date();
                await existingProductReviews.save();

                return res.status(200).json({
                    message: "Review updated successfully",
                    review: existingProductReviews.reviews[userReviewIndex],
                });
            }

            // User has not reviewed this product, add a new review
            existingProductReviews.reviews.push({
                userId: new mongoose.Types.ObjectId(userId),
                userName: userName,
                review: review,
                rating: rating || null, // Rating is optional
                reviewDate: new Date(),
            });
            await existingProductReviews.save();

            return res.status(200).json({
                message: "Review added successfully",
                review: existingProductReviews.reviews[existingProductReviews.reviews.length - 1],
            });
        }

        // No reviews exist for this product, create a new review document
        const newReview = {
            productId: new mongoose.Types.ObjectId(productId),
            reviews: [
                {
                    userId: new mongoose.Types.ObjectId(userId),
                    userName: userName,
                    review: review,
                    rating: rating || null, // Rating is optional
                    reviewDate: new Date()
                },
            ],
        };

        const createdReview = await Review.create(newReview);
        console.log("Review created successfully");

        return res.status(200).json({
            message: "Review created successfully",
            review: createdReview.reviews[0],
        });
    } catch (error) {
        console.error("Error creating review", error);
        res.status(500).json({ message: "Error creating review", error: error.message });
    }
};




export const getReviews = async (req,res) => {
    try {
        const { productId } =req.params;
        if(!productId){
            return res.status(400).json({message: "Product ID is required"});
        }
        const productReviews = await Review.findOne({productId});
        if(!productReviews){
            return res.status(200).json({message: "No reviews found for this product"});
        };
        // console.log("Product Reviews", productReviews.reviews,);
        return res.status(200).json({message: "Product reviews fetched successfully", reviews: productReviews.reviews});
    } catch (error) {
        console.log("Error fetching product reviews", error);
        res.status(500).json({message: "Error fetching product reviews"});
    }
}











export const deleteReview = async (req,res) => {
    try {
        const { productId, userId } = req.params;
        if(!productId || !userId){
            return res.status(400).json({message: "Product ID and User ID are required"});
        }
        const productReviews = await Review.findOne({productId});
        if(!productReviews){
            return res.status(404).json({message: "No reviews found for this product"});
        }
        const userReviewIndex = productReviews.reviews.findIndex((review) => review.userId.toString() === userId.toString());
        if(userReviewIndex === -1){
            return res.status(404).json({message: "Review not found for this user"});
        }
        // Remove the review from the array
        productReviews.reviews.splice(userReviewIndex,1);
        await productReviews.save();
        console.log("Review deleted successfully");
        return res.status(200).json({message: "Review deleted successfully", reviews: productReviews.reviews});
        
    } catch (error) {
        console.log("Error deleting review", error);
        res.status(500).json({message: "Error deleting review"});
    }
}