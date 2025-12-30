
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
        const jobObj = job.toObject ? job.toObject() : job;
        
        await renderVideo(jobObj.logo, jobObj.clips, jobObj._id, jobObj.bgAudio);

    } catch (err) {
        console.error("checkForRender error:", err);
    }
};


// old 2
// const generateFFMPEGCommand1 = (clips, outputPath, bgAudio) => {
//     const inputs = [];
//     const filterComplexParts = [];

//     const width = clips[0]?.width || 720;
//     const height = clips[0]?.height || 1280;

//     // Calculate total video duration
//     const totalDuration = clips.reduce((total, clip) => {
//         const startTime = clip.startTrim || 0;
//         const duration = (clip.endTrim || clip.duration) - startTime;
//         return total + duration;
//     }, 0);

//     // Process video clips
//     clips.forEach((clip, index) => {
//         const startTime = clip.startTrim || 0;
//         const duration = (clip.endTrim || clip.duration) - startTime;

//         inputs.push(`-i "${clip.sourceURL}"`);

//         filterComplexParts.push(
//             `[${index}:v]trim=start=${startTime}:duration=${duration},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`
//         );

//         filterComplexParts.push(
//             `[${index}:a]atrim=start=${startTime}:duration=${duration},asetpts=PTS-STARTPTS,aresample=async=1[a${index}]`
//         );
//     });
//     console.log("bgAudio ++++++----+++++  ",bgAudio);

//     // Handle background audio
//     if (bgAudio && bgAudio.url) {
//         console.log("Adding audio --------------");

//         inputs.push(`-i "${bgAudio.url}"`);
//         const bgAudioIndex = clips.length;
//         const volumeLevel = (bgAudio?.volume || 0.3); // Default to 30% volume

//         // Prepare background audio
//         let bgAudioFilter = `[${bgAudioIndex}:a]`;

//         if (bgAudio.isLooping) {
//             bgAudioFilter += `aloop=loop=-1:size=2e9,atrim=0:${totalDuration},asetpts=PTS-STARTPTS,`;
//         }

//         bgAudioFilter += `volume=${volumeLevel}[bgaudio]`;
//         filterComplexParts.push(bgAudioFilter);

//         // Concatenate video clips
//         const concatInputs = clips.map((_, index) => `[v${index}][a${index}]`).join('');
//         const concatVideoFilter = `${concatInputs}concat=n=${clips.length}:v=1:a=1[concatv][concala]`;

//         // Mix audio: original audio at 0.7, background at 0.3 (adjust as needed)
//         const mixFilter = `[concala]volume=0.7[origvol];[bgaudio]volume=0.3[bgvol];[origvol][bgvol]amix=inputs=2:duration=longest,volume=1.5[mixedaudio]`;

//         const fullFilter = `${filterComplexParts.join(';')};${concatVideoFilter};${mixFilter}`;

//         const command = [
//             'ffmpeg',
//             ...inputs,
//             '-filter_complex', fullFilter,
//             '-map', '[concatv]',
//             '-map', '[mixedaudio]',
//             '-c:v', 'libx264',
//             '-c:a', 'aac',
//             '-preset', 'fast',
//             '-crf', '23',
//             '-movflags', '+faststart',
//             '-y',
//             `"${outputPath}"`
//         ].join(' ');

//         console.log("FFmpeg command with background music:", command);
//         return command;
//     } else {
//         // Original logic without background audio
//         const concatInputs = clips.map((_, index) => `[v${index}][a${index}]`).join('');
//         const concatFilter = `${filterComplexParts.join(';')};${concatInputs}concat=n=${clips.length}:v=1:a=1[outv][outa]`;

//         const command = [
//             'ffmpeg',
//             ...inputs,
//             '-filter_complex', concatFilter,
//             '-map', '[outv]',
//             '-map', '[outa]',
//             '-c:v', 'libx264',
//             '-c:a', 'aac',
//             '-preset', 'fast',
//             '-crf', '23',
//             '-movflags', '+faststart',
//             '-y',
//             `"${outputPath}"`
//         ].join(' ');

//         console.log("FFmpeg command without background music:", command);
//         return command;
//     }
// };

const generateFFMPEGCommand = (clips, outputPath, bgAudio) => {
    const inputs = [];
    const filterComplexParts = [];
    const audioStreams = [];

    const width = clips[0]?.width || 720;
    const height = clips[0]?.height || 1280;

    // Calculate total video duration
    const totalDuration = clips.reduce((total, clip) => {
        const startTime = clip.startTrim || 0;
        const duration = (clip.endTrim || clip.duration) - startTime;
        return total + duration;
    }, 0);

    // Process video clips
    clips.forEach((clip, index) => {
        const startTime = clip.startTrim || 0;
        const duration = (clip.endTrim || clip.duration) - startTime;

        inputs.push(`-i "${clip.sourceURL}"`);

        filterComplexParts.push(
            `[${index}:v]trim=start=${startTime}:duration=${duration},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`
        );


        if (clip.hasAudio) {
            // Add audio processing with volume control
            const volume = clip.volume || 1;
            filterComplexParts.push(
                `[${index}:a]atrim=start=${startTime}:duration=${duration},asetpts=PTS-STARTPTS,aresample=async=1,volume=${volume}[a${index}]`
            );
            audioStreams.push(`[a${index}]`);
        } else {
            // If no audio, create silent audio track
            filterComplexParts.push(
                `anullsrc=channel_layout=stereo:sample_rate=48000[null${index}];[null${index}]atrim=0:${duration},asetpts=PTS-STARTPTS[a${index}]`
            );
            audioStreams.push(`[a${index}]`);
        }
    });
    // Handle background audio
    if (bgAudio && bgAudio.url) {
        console.log("Adding background audio");

        inputs.push(`-i "${bgAudio.url}"`);
        const bgAudioIndex = clips.length;
        const volumeLevel = (bgAudio?.volume || 0.3);

        // Prepare background audio
        let bgAudioFilter = `[${bgAudioIndex}:a]`;

        if (bgAudio.isLooping) {
            bgAudioFilter += `aloop=loop=-1:size=2e9,atrim=0:${totalDuration},asetpts=PTS-STARTPTS,`;
        }

        bgAudioFilter += `volume=${volumeLevel}[bgaudio]`;
        filterComplexParts.push(bgAudioFilter);

        // Concatenate all video audio streams
        if (audioStreams.length > 0) {
            const concatAudioFilter = `${audioStreams.join('')}concat=n=${clips.length}:v=0:a=1[concala]`;
            filterComplexParts.push(concatAudioFilter);
        } else {
            // If no video audio at all, create empty audio stream
            filterComplexParts.push(`anullsrc=channel_layout=stereo:sample_rate=48000[concala]`);
        }

        // Concatenate video streams
        const concatVideoFilter = clips.map((_, index) => `[v${index}]`).join('') +
            `concat=n=${clips.length}:v=1:a=0[concatv]`;
        filterComplexParts.push(concatVideoFilter);

        // Mix video audio with background audio
        let audioMixFilter;
        if (audioStreams.length > 0) {
            // Mix both audio sources: video audio at 0.7, background at 0.3 (adjust as needed)
            audioMixFilter = `[concala]volume=0.7[origvol];[bgaudio]volume=0.3[bgvol];[origvol][bgvol]amix=inputs=2:duration=longest,volume=1.5[mixedaudio]`;
        } else {
            // Only background audio
            audioMixFilter = `[bgaudio]volume=1.0[mixedaudio]`;
        }
        filterComplexParts.push(audioMixFilter);

        const fullFilter = filterComplexParts.join(';');

        const command = [
            'ffmpeg',
            ...inputs,
            '-filter_complex', fullFilter,
            '-map', '[concatv]',
            '-map', '[mixedaudio]',
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-preset', 'fast',
            '-crf', '23',
            '-movflags', '+faststart',
            '-y',
            `"${outputPath}"`
        ].join(' ');

        console.log("FFmpeg command with background music:", command);
        return command;
    } else {
        // No background audio
        // Concatenate videos
        const concatVideoFilter = clips.map((_, index) => `[v${index}]`).join('') +
            `concat=n=${clips.length}:v=1:a=0[outv]`;

        // Concatenate audio streams if they exist
        let concatAudioFilter = '';
        let finalAudioMap = '';

        if (audioStreams.length > 0) {
            concatAudioFilter = `${audioStreams.join('')}concat=n=${clips.length}:v=0:a=1[outa]`;
            finalAudioMap = '-map [outa]';
        } else {
            // Create silent audio track if no audio at all
            concatAudioFilter = `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${totalDuration}[outa]`;
            finalAudioMap = '-map [outa]';
        }

        const fullFilter = `${filterComplexParts.join(';')};${concatVideoFilter};${concatAudioFilter}`;

        const command = [
            'ffmpeg',
            ...inputs,
            '-filter_complex', fullFilter,
            '-map', '[outv]',
            ...(finalAudioMap ? [finalAudioMap] : []),
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-preset', 'fast',
            '-crf', '23',
            '-movflags', '+faststart',
            '-y',
            `"${outputPath}"`
        ].join(' ');

        console.log("FFmpeg command without background music:", command);
        return command;
    }
};

// Helper function to check if a video has audio (you might want to implement this separately)
// You would need to probe the video first to check for audio streams
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
            const { url, x, y, width, opacity, aspectRatio, originalWidth, originalHeight } = logo;

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
            const logoCmd = `ffmpeg -i "${outputPath}" -i "${url}" -filter_complex "[1:v]scale=${logoWidthInPixels}:${logoHeightInPixels},format=rgba,colorchannelmixer=aa=${opacity}[logo];[0:v][logo]overlay=${finalX}:${finalY}" -c:a copy "${outputWithLogoPath}"`;

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
                thumbnailUrl = await generateAndUploadThumbnail(clips[0], videoEditorId,finalResolvedPath);
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


export const generateAndUploadThumbnail = async (clip, videoEditorId,finalResolvedPath) => {
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

        const ffmpegCommand = `ffmpeg -ss ${thumbnailTime} -i "${finalResolvedPath}" -frames:v 1 -qscale:v 2 -vf "scale=${clip.width || 704}:${clip.height || 1248}" ${thumbnailPath}`;

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

