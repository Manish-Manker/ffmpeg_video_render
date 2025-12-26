import mongoose, { Schema, model } from "mongoose";


const videoEditorSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        title: { type: String, required: true },
        slug: { type: String, default: "" },
        portrait: {
            image: { type: String },
            video: { type: String },
        },

        mettafinalVideoFile: {
            url: { type: String },
            key: { type: String },
            height: { type: String },
            width: { type: String },
            formate: { type: String },
            duration: { type: String },
        },

        logo: { type: mongoose.Schema.Types.Mixed, default: null },
        clips: { type: mongoose.Schema.Types.Mixed, default: null },
        status: {
            type: String,
            enum: ['draft', 'processing', 'completed', 'failed', 'rendering'],
        },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
    },
    {
        timestamps: true,
    }
);

const videoEditorModel = model("VideoEditor", videoEditorSchema);
export default videoEditorModel;
