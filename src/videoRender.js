
import videoEditorModel from "./models/VideoEditor.js";
import fs from 'fs/promises';
import path from 'path';
import { fileToUpload } from './fileUpload.js';
import { promisify } from 'util';
import { exec } from "child_process";
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
        const jobObj = job.toObject ? job.toObject() : job;
 
        if (!jobObj?.renderData?.clips && jobObj?.renderData?.clips?.length == 0) {
            console.log("No clips available for video to render : ", jobObj._id);
            await videoEditorModel.findByIdAndUpdate(jobObj._id, {
                status: "failed",
            });
            return;
        }
        const { clips = [], bgAudio, logo } = jobObj.renderData || {}
        await renderVideo(logo, clips, jobObj._id, bgAudio);
 
    } catch (err) {
        console.error("checkForRender error:", err);
    }
};
 
// old wotking code 

// const generateFFMPEGCommand = (clips, outputPath, bgAudio) => {
//     const inputs = [];
//     const filters = [];
 
//     const outWidth = clips[0]?.width || 720;
//     const outHeight = clips[0]?.height || 1280;
 
//     let inputIndex = 0;
 
//     // ---------------------------------------------------
//     // 1. VIDEO INPUTS (always first)
//     // ---------------------------------------------------
//     clips.forEach(clip => {
//         inputs.push(`-i "${clip.sourceURL}"`);
//         clip._videoInput = inputIndex++;
//     });
 
//     // ---------------------------------------------------
//     // 2. EXTERNAL AUDIO INPUTS (per clip)
//     // ---------------------------------------------------
//     clips.forEach(clip => {
//         if (clip.audio?.sourceURL) {
//             inputs.push(`-i "${clip.audio.sourceURL}"`);
//             clip._extAudioInput = inputIndex++;
//         }
//     });
 
//     // ---------------------------------------------------
//     // 3. BACKGROUND AUDIO INPUT
//     // ---------------------------------------------------
//     if (bgAudio?.sourceURL) {
//         inputs.push(`-i "${bgAudio.sourceURL}"`);
//         bgAudio._input = inputIndex++;
//     }
 
//     // ---------------------------------------------------
//     // 4. PROCESS EACH CLIP
//     // ---------------------------------------------------
//     clips.forEach((clip, i) => {
//         const vIn = clip._videoInput;
//         const start = clip.startTrim || 0;
//         const duration = (clip.endTrim || clip.duration) - start;
 
//         // ---- Video
//         filters.push(
//             `[${vIn}:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,` +
//             `scale=${outWidth}:${outHeight}:force_original_aspect_ratio=decrease,` +
//             `pad=${outWidth}:${outHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`
//         );
 
//         const audioLayers = [];
 
//         // ---- Video Audio
//         if (clip.hasAudio) {
//             filters.push(
//                 `[${vIn}:a]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,` +
//                 `volume=${clip.volume ?? 1}[va${i}]`
//             );
//             audioLayers.push(`[va${i}]`);
//         }
 
//         // ---- External Clip Audio
//         if (clip._extAudioInput !== undefined) {
//             const aStart = clip.audio.startTrim || 0;
//             const aDur = Math.min(
//                 (clip.audio.endTrim || clip.audio.duration) - aStart,
//                 duration
//             );
 
//             filters.push(
//                 `[${clip._extAudioInput}:a]atrim=start=${aStart}:duration=${aDur},` +
//                 `asetpts=PTS-STARTPTS,volume=${clip.audio.volume ?? 0.5}[ea${i}]`
//             );
//             audioLayers.push(`[ea${i}]`);
//         }
 
//         // ---- Mix or Silence
//         if (audioLayers.length > 0) {
//             filters.push(
//                 `${audioLayers.join('')}amix=inputs=${audioLayers.length}:normalize=0[a${i}]`
//             );
//         } else {
//             filters.push(
//                 `anullsrc=channel_layout=stereo:sample_rate=48000:d=${duration}[a${i}]`
//             );
//         }
//     });
 
//     // ---------------------------------------------------
//     // 5. CONCAT VIDEO + AUDIO
//     // ---------------------------------------------------
//     filters.push(
//         `${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[concatv]`
//     );
 
//     filters.push(
//         `${clips.map((_, i) => `[a${i}]`).join('')}concat=n=${clips.length}:v=0:a=1[concata]`
//     );
 
//     // ---------------------------------------------------
//     // 6. BACKGROUND AUDIO MIX
//     // ---------------------------------------------------
//     if (bgAudio?.sourceURL) {
//         const totalDuration = clips.reduce(
//             (sum, c) => sum + ((c.endTrim || c.duration) - (c.startTrim || 0)),
//             0
//         );
 
//         let bgChain = `[${bgAudio._input}:a]`;
 
//         if (bgAudio.isLooping) {
//             bgChain += `aloop=loop=-1:size=2e9,`;
//         }
 
//         bgChain += `atrim=0:${totalDuration},asetpts=PTS-STARTPTS,` +
//             `volume=${bgAudio.volume ?? 0.3}[bg]`;
 
//         filters.push(bgChain);
 
//         filters.push(
//             `[concata][bg]amix=inputs=2:duration=longest:dropout_transition=2[mixout]`
//         );
//     }
 
//     // ---------------------------------------------------
//     // 7. FINAL COMMAND
//     // ---------------------------------------------------
//     const filterComplex = filters.join(';');
 
//     return [
//         'ffmpeg',
//         ...inputs,
//         '-filter_complex', `"${filterComplex}"`,
//         '-map', '[concatv]',
//         '-map', bgAudio?.sourceURL ? '[mixout]' : '[concata]',
//         '-c:v', 'libx264',
//         '-c:a', 'aac',
//         '-preset', 'fast',
//         '-crf', '23',
//         '-movflags', '+faststart',
//         '-y',
//         `"${outputPath}"`
//     ].join(' ');
// };
 
 const generateFFMPEGCommand = (clips, outputPath, bgAudio) => {
    const inputs = [];
    const filters = [];

    const outWidth = clips[0]?.width || 720;
    const outHeight = clips[0]?.height || 1280;

    let inputIndex = 0;

    // ---------------------------------------------------
    // 1. INPUTS
    // ---------------------------------------------------
    clips.forEach(clip => {
        if (clip.type === "image") {
            // loop image for duration
            inputs.push(`-loop 1 -t ${clip.duration} -i "${clip.sourceURL}"`);
        } else {
            inputs.push(`-i "${clip.sourceURL}"`);
        }
        clip._videoInput = inputIndex++;
    });

    clips.forEach(clip => {
        if (clip.audio?.sourceURL) {
            inputs.push(`-i "${clip.audio.sourceURL}"`);
            clip._extAudioInput = inputIndex++;
        }
    });

    if (bgAudio?.sourceURL) {
        inputs.push(`-i "${bgAudio.sourceURL}"`);
        bgAudio._input = inputIndex++;
    }

    // ---------------------------------------------------
    // 2. PROCESS CLIPS
    // ---------------------------------------------------
    clips.forEach((clip, i) => {
        const vIn = clip._videoInput;
        const start = clip.startTrim || 0;
        const duration = (clip.endTrim || clip.duration) - start;

        if (clip.type === "image") {
            // -------- IMAGE WITH BLUR BACKGROUND --------
            filters.push(
                // background
                `[${vIn}:v]scale=${outWidth}:${outHeight}:force_original_aspect_ratio=increase,` +
                `crop=${outWidth}:${outHeight},gblur=sigma=50,eq=brightness=-0.1[bg${i}]`
            );

            filters.push(
                // foreground
                `[${vIn}:v]scale=${outWidth}:${outHeight}:force_original_aspect_ratio=decrease[fg${i}]`
            );

            filters.push(
                // overlay
                `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,` +
                `trim=duration=${duration},setpts=PTS-STARTPTS,setsar=1[v${i}]`
            );
        } else {
            // -------- VIDEO (UNCHANGED) --------
            filters.push(
                `[${vIn}:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,` +
                `scale=${outWidth}:${outHeight}:force_original_aspect_ratio=decrease,` +
                `pad=${outWidth}:${outHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`
            );
        }

        const audioLayers = [];

        if (clip.hasAudio) {
            filters.push(
                `[${vIn}:a]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,` +
                `volume=${clip.volume ?? 1}[va${i}]`
            );
            audioLayers.push(`[va${i}]`);
        }

        if (clip._extAudioInput !== undefined) {
            const aStart = clip.audio.startTrim || 0;
            const aDur = Math.min(
                (clip.audio.endTrim || clip.audio.duration) - aStart,
                duration
            );

            filters.push(
                `[${clip._extAudioInput}:a]atrim=start=${aStart}:duration=${aDur},` +
                `asetpts=PTS-STARTPTS,volume=${clip.audio.volume ?? 0.5}[ea${i}]`
            );
            audioLayers.push(`[ea${i}]`);
        }

        if (audioLayers.length > 0) {
            filters.push(
                `${audioLayers.join("")}amix=inputs=${audioLayers.length}:normalize=0[a${i}]`
            );
        } else {
            filters.push(
                `anullsrc=channel_layout=stereo:sample_rate=48000:d=${duration}[a${i}]`
            );
        }
    });

    // ---------------------------------------------------
    // 3. CONCAT
    // ---------------------------------------------------
    filters.push(
        `${clips.map((_, i) => `[v${i}]`).join("")}concat=n=${clips.length}:v=1:a=0[concatv]`
    );

    filters.push(
        `${clips.map((_, i) => `[a${i}]`).join("")}concat=n=${clips.length}:v=0:a=1[concata]`
    );

    // ---------------------------------------------------
    // 4. BACKGROUND AUDIO
    // ---------------------------------------------------
    if (bgAudio?.sourceURL) {
        const totalDuration = clips.reduce(
            (sum, c) => sum + ((c.endTrim || c.duration) - (c.startTrim || 0)),
            0
        );

        let bgChain = `[${bgAudio._input}:a]`;

        if (bgAudio.isLooping) {
            bgChain += `aloop=loop=-1:size=2e9,`;
        }

        bgChain += `atrim=0:${totalDuration},asetpts=PTS-STARTPTS,` +
            `volume=${bgAudio.volume ?? 0.3}[bg]`;

        filters.push(bgChain);

        filters.push(
            `[concata][bg]amix=inputs=2:duration=longest:dropout_transition=2[mixout]`
        );
    }

    // ---------------------------------------------------
    // 5. FINAL COMMAND
    // ---------------------------------------------------
    return [
        "ffmpeg",
        ...inputs,
        "-filter_complex", `"${filters.join(";")}"`,
        "-map", "[concatv]",
        "-map", bgAudio?.sourceURL ? "[mixout]" : "[concata]",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-y",
        `"${outputPath}"`
    ].join(" ");
};

 
const checkVideoHasAudio = async (videoPath, timeout = 5000) => {
    try {
        const command = `ffprobe -v error -show_streams -select_streams a -of json -timeout 5000000 "${videoPath}"`;
 
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
 
        const { stdout } = await execAsync(command, { signal: controller.signal });
        clearTimeout(timeoutId);
 
        const probeData = JSON.parse(stdout);
        return probeData.streams && probeData.streams.length > 0;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.warn(`Audio check timeout for ${videoPath}`);
        } else {
            console.error(`Error checking audio for ${videoPath}:`, error.message);
        }
        return false;
    }
};
 
const renderVideo = async (logo, clips, videoEditorId, bgAudio) => {
 
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
 
        const clipsWithAudio = await Promise.all(
            clips.map(async (clip) => {
                const hasAudio = await checkVideoHasAudio(clip.sourceURL);
                return {
                    ...clip,
                    hasAudio
                };
            })
        );
 
 
        console.log(`Merging clips for bgAudio -> : ${bgAudio}`);
        const clipMergeCommand = await generateFFMPEGCommand(clipsWithAudio, outputPath, bgAudio);
 
 
        await execAsync(clipMergeCommand);
        console.log(`Clips merged successfully for video: ${videoEditorId}`);
 
 
        if (logo && Object.keys(logo).length > 0) {
            console.log(`Adding logo to video: ${videoEditorId}`);
 
            const videoWidth = clips[0]?.width || 704;
            const videoHeight = clips[0]?.height || 1248;
            const { sourceURL, x, y, width, opacity, aspectRatio, originalWidth, originalHeight } = logo;
 
            // Calculate logo dimensions in pixels
            const logoWidthInPixels = Math.round((width / 100) * videoWidth);
 
            // Calculate height based on original aspect ratio, not the provided aspectRatio
            // Use original dimensions to get correct aspect ratio
            const actualAspectRatio = originalWidth / originalHeight; // Should be ~500/79 = 6.33
            const logoHeightInPixels = Math.round(logoWidthInPixels / actualAspectRatio);
 
            // Calculate position
            const xInPixels = Math.round((x / 100) * videoWidth);
            const yInPixels = Math.round((y / 100) * videoHeight);
 
            // Ensure logo doesn't go outside video bounds
            const maxX = videoWidth - logoWidthInPixels;
            const maxY = videoHeight - logoHeightInPixels;
            const finalX = Math.max(0, Math.min(xInPixels, maxX));
            const finalY = Math.max(0, Math.min(yInPixels, maxY));
 
            const outputWithLogoPath = `outputs/${timestamp}-with-logo.mp4`;
 
            // Use scale=width:height syntax
            const logoCmd = `ffmpeg -i "${outputPath}" -i "${sourceURL}" -filter_complex "[1:v]scale=${logoWidthInPixels}:${logoHeightInPixels},format=rgba,colorchannelmixer=aa=${opacity}[logo];[0:v][logo]overlay=${finalX}:${finalY}" -c:a copy "${outputWithLogoPath}"`;
 
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
                // thumbnailUrl = await generateAndUploadThumbnail(clips[0], videoEditorId, finalResolvedPath);
                thumbnailUrl = "asdf";
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
            media: {
                url: finalVideoFile,
                thumbnail: thumbnailUrl || "",
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
 
export const generateAndUploadThumbnail = async (clip, videoEditorId, finalResolvedPath) => {
    let thumbnailPath = null;
 
    try {
        console.log(`Generating thumbnail for video: ${videoEditorId}`);
        try {
            await fs.access("thumbnails");
        } catch {
            await fs.mkdir("thumbnails");
        }
        const timestamp = Date.now();
        thumbnailPath = `thumbnails/${timestamp}-${videoEditorId}-thumbnail.jpg`;
 
        const thumbnailTime = Math.min(0.5, (clip.duration || 10) / 2);
 
        const ffmpegCommand = `ffmpeg -ss ${thumbnailTime} -i "${finalResolvedPath}" -frames:v 1 -qscale:v 2 -vf "scale=${clip.width || 704}:${clip.height || 1248}" ${thumbnailPath}`;
 
        console.log(`Executing thumbnail command: ${ffmpegCommand}`);
 
        await execAsync(ffmpegCommand, { timeout: 30000 });
 
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
 
 