
import { exec } from "child_process";
import videoEditorModel from "./models/VideoEditor.js";
import fs from 'fs/promises';
import path from 'path';
import { fileToUpload } from './fileUpload.js';
import { promisify } from 'util';
const execAsync = promisify(exec);


export const checkForRender = async () => {
    try {
        // Check if any video is already rendering (with timeout logic)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        const stuckRendering = await videoEditorModel.findOne({
            status: "rendering",
            updatedAt: { $lt: oneHourAgo }
        });

        if (stuckRendering) {
            console.warn(`failed stuck video: ${stuckRendering._id}`);
            await videoEditorModel.findByIdAndUpdate(stuckRendering._id, {
                status: "failed",
            });
        }

        // Check for active (non-stuck) rendering videos
        const activeRendering = await videoEditorModel.exists({
            status: "rendering",
            updatedAt: { $gte: oneHourAgo }
        });

        if (activeRendering) {
            console.log("Video is already rendering");
            return;
        }

        // Atomically pick & lock ONE processing job
        const job = await videoEditorModel.findOneAndUpdate(
            { status: "processing" },
            {
                $set: {
                    status: "rendering",
                }
            },
            {
                sort: { createdAt: 1 }, // Process oldest first
                new: true
            }
        );

        if (!job) {
            console.log("No videos to process");
            return;
        }

        // Render the video
        await renderVideo(job.logo, job.clips, job._id);

    } catch (err) {
        console.error("checkForRender error:", err);
    }
};

function escapeShellArg(arg) {
    return `'${arg.replace(/'/g, "'\"'\"'")}'`;
}

const generateFFMPEGCommand = (clips, outputPath) => {
    const inputs = [];
    const filterComplexParts = [];

    // Get dimensions from first clip (assuming all clips should match)
    const width = clips[0]?.width || 720;
    const height = clips[0]?.height || 1280;

    // Process each clip
    clips.forEach((clip, index) => {
        const startTime = clip.startTrim || 0;
        const duration = (clip.endTrim || clip.duration) - startTime;

        // Add input with seeking at decode time (more accurate)
        inputs.push(`-i ${escapeShellArg(clip.sourceURL)}`);

        // Trim each clip: use trim filter for accurate cutting
        // [index:v] selects video stream, [index:a] selects audio stream
        filterComplexParts.push(
            `[${index}:v]trim=start=${startTime}:duration=${duration},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`
        );

        // Handle audio - trim similarly
        filterComplexParts.push(
            `[${index}:a]atrim=start=${startTime}:duration=${duration},asetpts=PTS-STARTPTS,aresample=async=1[a${index}]`
        );
    });

    // Concatenation part
    const concatInputs = clips.map((_, index) => `[v${index}][a${index}]`).join('');
    const concatFilter = `${filterComplexParts.join(';')};${concatInputs}concat=n=${clips.length}:v=1:a=1[outv][outa]`;

    // Build final command
    const command = [
        'ffmpeg',
        ...inputs,
        '-filter_complex', escapeShellArg(concatFilter),
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',      // Video codec
        '-c:a', 'aac',          // Audio codec
        '-preset', 'fast',      // Encoding speed
        '-crf', '23',           // Quality (lower = better)
        '-movflags', '+faststart', // Optimize for web playback
        '-y',                   // Overwrite output
        escapeShellArg(outputPath)       // Output file
    ].join(' ');

    console.log("Generated FFmpeg command:", command);
    return command;
};


const renderVideo = async (logo, clips, videoEditorId) => {
    let outputPath, finalVideoPath;

    try {
        console.log(`Starting render for video: ${videoEditorId}`);


        await videoEditorModel.findByIdAndUpdate(videoEditorId, {
            status: "rendering"
        });


        try {
            await fs.access("outputs");
        } catch {
            await fs.mkdir("outputs");
        }


        const timestamp = Date.now();
        outputPath = `outputs/${timestamp}-vid.mp4`;
        finalVideoPath = outputPath;


        console.log(`Merging clips for video: ${videoEditorId}`);
        const clipMergeCommand = await generateFFMPEGCommand(clips, outputPath);


        await execAsync(clipMergeCommand);
        console.log(`Clips merged successfully for video: ${videoEditorId}`);


        if (logo && Object.keys(logo).length > 0) {
            console.log(`Adding logo to video: ${videoEditorId}`);

            const videoWidth = clips[0]?.width || 704;
            const videoHeight = clips[0]?.height || 1248;
            const { url, x, y, width, opacity, aspectRatio } = logo;

            const logoWidthInPixels = Math.round((width / 100) * videoWidth);
            const xInPixels = Math.round((x / 100) * videoWidth);
            const yInPixels = Math.round((y / 100) * videoHeight);

            const outputWithLogoPath = `outputs/${timestamp}-with-logo.mp4`;

            const logoCmd = `ffmpeg -i ${outputPath} -i ${url} -filter_complex "[1:v]scale=${logoWidthInPixels * aspectRatio}:-1,format=rgba,colorchannelmixer=aa=${opacity}[logo];[0:v][logo]overlay=${xInPixels}:${yInPixels}" -c:a copy ${outputWithLogoPath}`;

            await execAsync(logoCmd);


            try {
                await fs.unlink(outputPath);
            } catch (unlinkErr) {
                console.warn(`Failed to delete intermediate file: ${unlinkErr.message}`);
            }

            finalVideoPath = outputWithLogoPath;
            console.log(`Logo added successfully for video: ${videoEditorId}`);
        }


        console.log(`Uploading video: ${videoEditorId}`);
        const finalResolvedPath = path.resolve(finalVideoPath);

        const uploadResponse = await fileToUpload(
            { tempFilePath: finalResolvedPath },
            {
                name: `${timestamp}-rendered-video.mp4`,
                saveOnDb: true
            }
        );

        const finalVideoFile = uploadResponse?.data?.url || finalVideoPath;
        let thumbnailUrl = null;
        if (clips && clips.length > 0) {
            try {
                thumbnailUrl = await generateAndUploadThumbnail(clips[0], videoEditorId);
            } catch (thumbnailError) {
                console.warn(`Failed to generate thumbnail for ${videoEditorId}:`, thumbnailError);
                // Continue even if thumbnail generation fails
            }
        }

        await videoEditorModel.findByIdAndUpdate(videoEditorId, {
            status: "completed",
            portrait: {
                image: thumbnailUrl,
                video: finalVideoFile,
            },
            mettafinalVideoFile: {
                url: finalVideoFile,
                key: uploadResponse?.data?.key || "",
                height: clips[0]?.height || 1248,
                width: clips[0]?.width || 704,
                format: "mp4",
                duration: ""
            },
            updatedAt: new Date()
        });

        console.log(`Video rendered and uploaded successfully: ${videoEditorId}`);


        try {
            if (finalVideoPath && await fs.access(finalVideoPath).then(() => true).catch(() => false)) {
                await fs.unlink(finalVideoPath);
            }
        } catch (cleanupErr) {
            console.warn(`Failed to clean up file ${finalVideoPath}:`, cleanupErr.message);
        }

        return { success: true, videoEditorId, finalVideoFile };

    } catch (error) {
        console.error(`Error rendering video ${videoEditorId}:`, error);


        try {
            await videoEditorModel.findByIdAndUpdate(videoEditorId, {
                status: "failed",
            });
        } catch (dbError) {
            console.error(`Failed to update error status for ${videoEditorId}:`, dbError);
        }


        try {
            if (outputPath && await fs.access(outputPath).then(() => true).catch(() => false)) {
                await fs.unlink(outputPath);
            }
            if (finalVideoPath && outputPath !== finalVideoPath &&
                await fs.access(finalVideoPath).then(() => true).catch(() => false)) {
                await fs.unlink(finalVideoPath);
            }
        } catch (cleanupErr) {
            console.warn("Failed to clean up files after error:", cleanupErr.message);
        }

        throw error;
    }
};


export const generateAndUploadThumbnail = async (clip, videoEditorId) => {
    let thumbnailPath = null;

    try {
        console.log(`Generating thumbnail for video: ${videoEditorId}`);

        // Create thumbnails directory if it doesn't exist
        try {
            await fs.access("thumbnails");
        } catch {
            await fs.mkdir("thumbnails");
        }

        // Generate unique filename
        const timestamp = Date.now();
        thumbnailPath = `thumbnails/${timestamp}-${videoEditorId}-thumbnail.jpg`;

        const thumbnailTime = Math.min(0.5, (clip.duration || 10) / 2);
     
        const ffmpegCommand = `ffmpeg -ss ${thumbnailTime} -i ${escapeShellArg(clip.sourceURL)} -frames:v 1 -qscale:v 2 -vf "scale=${clip.width || 704}:${clip.height || 1248}" ${escapeShellArg(thumbnailPath)}`;

        console.log(`Executing thumbnail command: ${ffmpegCommand}`);

        await execAsync(ffmpegCommand, { timeout: 30000 }); 

        // Verify thumbnail was created
        try {
            await fs.access(thumbnailPath);
            const stats = await fs.stat(thumbnailPath);
            if (stats.size === 0) {
                throw new Error("Generated thumbnail file is empty");
            }
            console.log(`Thumbnail created successfully: ${thumbnailPath} (${stats.size} bytes)`);
        } catch (accessErr) {
            throw new Error(`Thumbnail file not created: ${accessErr.message}`);
        }

        
        const uploadResponse = await fileToUpload(
            { tempFilePath: path.resolve(thumbnailPath) },
            {
                name: `${timestamp}-${videoEditorId}-thumbnail.jpg`,
                saveOnDb: true
            }
        );

        const thumbnailUrl = uploadResponse?.data?.url || thumbnailPath;
        console.log(`Thumbnail uploaded successfully: ${thumbnailUrl}`);

        try {
            await fs.unlink(thumbnailPath);
            console.log(`Cleaned up local thumbnail: ${thumbnailPath}`);
        } catch (cleanupErr) {
            console.warn(`Failed to clean up thumbnail file: ${cleanupErr.message}`);
        }

        return thumbnailUrl;

    } catch (error) {
        console.error(`Error generating thumbnail for ${videoEditorId}:`, error);

        // Clean up on error
        if (thumbnailPath) {
            try {
                if (await fs.access(thumbnailPath).then(() => true).catch(() => false)) {
                    await fs.unlink(thumbnailPath);
                }
            } catch (cleanupErr) {
                console.warn(`Failed to clean up thumbnail after error: ${cleanupErr.message}`);
            }
        }

        return null;
    }
};