import { Schema, model } from "mongoose";
 
 
const videoEditorSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        media: {
            url: { type: String, default: "" },
            thumbnail: { type: String, default: "" },
            key: { type: String, default: "" },
            width: { type: Number },
            height: { type: Number },
            format: { type: String },
            duration: { type: Number },
            size: { type: Number },
        },
        portrait: {
            image: { type: String, default: "" },
            video: { type: String, default: "" },
        },
        editorData: {
            type: Schema.Types.Mixed, default: null
        },
        renderData: {
            type: Schema.Types.Mixed, default: null
        },
        status: {
            type: String,
            enum: ["draft", "rendering", "processing", "completed", "failed"],
            default: "draft",
            index: true,
        },
        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },
        deletedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);
const videoEditorModel = model("VideoEditor", videoEditorSchema);
export default videoEditorModel;
 
 