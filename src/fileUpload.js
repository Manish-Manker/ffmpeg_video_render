import fs from 'fs';
import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";

dotenv.config();

export const fileToUpload = async (file, options = {}) => {
    try {
        const url = process.env.PIXAUPLOADURL + "filetoupload";

        const formData = new FormData();
        formData.append("file", fs.createReadStream(file?.tempFilePath || file), file?.name);
        formData.append("path", options.path || "");
        formData.append("name", options.name || "");
        formData.append("saveOnDb", String(options.saveOnDb || false));

        const headers = {
            ...formData.getHeaders(),
            Authorization: process.env.PIXAUPLOADSEC,
        };

        try {
            const respData = await axios.post(url, formData, { headers });
            return respData.data;
        } catch (error) {
            console.log(error);
            return error;
        }
    } catch (e) {
        console.log("error ", e);
    }

};


const deleteObject = async (type, options = {}) => {
    const url = process.env.PIXAUPLOADURL + "deleteobject";
    console.log("url  ---- ",url);
    
    const requestBody = {
        type: "url",
        key: "showcaseai/temp/0.3607894353305374.mp4",
        url: "https://d3orgd3vfbg4nb.cloudfront.net/showcaseai/temp/0.3607894353305374.mp4",
        deleteFromDb: options.deleteFromDb || false,
    };
    const headers = {
        Authorization: process.env.PIXAUPLOADSEC,
    };

    try {
        const respData = await axios.post(url, requestBody, { headers });
        return respData.data;
    } catch (error) {
        return error;
    }
};

// const asd = await deleteObject();

// console.log("asd ->>> ",asd);
