import fs from 'fs';
import axios from "axios";
import FormData from "form-data";

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