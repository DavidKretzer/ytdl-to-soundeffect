const fs = require('fs');
const { execFile } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const express = require('express');
const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');

ffmpeg.setFfmpegPath('bin\\ffmpeg\\ffmpeg.exe');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use((req, res, next) => {
    if (req.headers.upgrade === 'websocket') {
        wss.handleUpgrade(req, req.socket, Buffer.alloc(0), (ws) => {
            wss.emit('connection', ws, req);
        });
    } else next();
});

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        const data = JSON.parse(message);

        try {
            const filePath = await downloadAndConvert(
                data.videoUrl,
                data.speedUp === 'yes' || null,
                data.startTime ? parseFloat(data.startTime) : null,
                data.endTime ? parseFloat(data.endTime) : null,
                data.removeSilence !== 'no'
            );

            ws.send(JSON.stringify({ type: 'filePath', filePath }));
        } catch (error) {
            console.error('Error during download and conversion:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Error during download and conversion.' }));
        }
    });
});

async function downloadAndConvert(videoUrl, speedUp, startTime, endTime, removeSilence) {
    const videoPath = `temp\\${crypto.randomBytes(4).toString('hex')}.mp3`;
    const outputFilename = `${crypto.randomBytes(4).toString('hex')}.mp3`;

    const videoDuration = await downloadVideo(videoUrl, videoPath);

    await convertVideoToMp3(videoPath, `output\\${outputFilename}`, startTime, endTime, removeSilence);
    fs.unlinkSync(videoPath);

    if (speedUp) {
        const spedUpOutputFilename = `${outputFilename.split('.').slice(0, -1).join('.')}_sped_up_${crypto.randomBytes(4).toString('hex')}.mp3`;
        const targetDuration = 4.98;
        const adjustedDuration = endTime ? (endTime - startTime) : (videoDuration - startTime);
        const speedMultiplier = adjustedDuration / targetDuration;
        await speedUpAudio(`output\\${outputFilename}`, `output\\${spedUpOutputFilename}`, speedMultiplier);
        return spedUpOutputFilename;
    }

    return outputFilename;
}

async function downloadVideo(videoUrl, outputPath) {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        env.PATH = `${env.PATH};${process.cwd()}\\bin\\ffmpeg;${process.cwd()}\\bin`;
        const downloadProcess = execFile(
            'yt-dlp',
            [
                '--newline',
                '-o',
                outputPath,
                '-f',
                'bestaudio/best',
                '--print-json',
                videoUrl
            ],
            { env }
        );

        let metadata = '';

        downloadProcess.stdout.on('data', (data) => {
            metadata += data.toString();
            console.log(`Download progress: ${data.toString()}`);
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'progress', progress: data.toString() }));
                }
            });
        });

        downloadProcess.on('error', (error) => reject(error));

        downloadProcess.on('close', (code) => {
            if (code === 0) {
                const metadataJSON = JSON.parse(metadata);
                const duration = metadataJSON.duration;
                resolve(duration);
            } else reject(new Error(`Download process exited with code ${code}`));
        });
    });
}

function convertVideoToMp3(videoPath, outputFilename, startTime, endTime, removeSilence) {
    return new Promise((resolve) => {
        const outputStream = fs.createWriteStream(outputFilename);
        const converter = ffmpeg(videoPath)
            .withNoVideo()
            .toFormat('mp3')
            .on('error', (err) => console.error('Error occurred during conversion:', err.message))
            .on('progress', (progress) => console.log('Progress:', progress.timemark))
            .on('end', () => {
                console.log('Conversion completed successfully.');
                resolve();
            });

        if (startTime) converter.seekInput(startTime);
        if (endTime) converter.setDuration(endTime - startTime);
        if (removeSilence) converter.audioFilters('silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB');

        converter.pipe(outputStream);
    });
}

function speedUpAudio(inputFilename, outputFilename, speed) {
    return new Promise((resolve) => {
        const outputStream = fs.createWriteStream(outputFilename);
        const converter = ffmpeg(inputFilename)
            .toFormat('mp3')
            .on('error', (err) => {
                console.error('Error occurred during speed up:', err.message);
            })
            .on('progress', (progress) => {
                console.log('Speed up progress:', progress.timemark);
            })
            .on('end', () => {
                console.log('Speed up completed successfully.');
                resolve();
            });

        if (speed) converter.audioFilters(`atempo=${speed}`);

        converter.pipe(outputStream);
    });
}

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

server.listen(80, () => {
    console.log(`Server is listening on port 80`);
});

/*

Redundant code

app.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    res.download(`output/${filename}`, (err) => {
        if (err) {
            console.error('Error sending file:', err);
            res.status(500).send('Error sending file.');
        } else {
            console.log('File sent successfully.');
            fs.unlinkSync(`output/${filename}`);
        }
    });
});

app.post('/convert', async (req, res) => {
    console.log('Recieved request.')

    let { videoUrl, speedUp, startTime, endTime, removeSilence } = req.body;

    try {
        const filePath = await downloadAndConvert(
            videoUrl,
            speedUp === 'yes' || null,
            startTime ? parseFloat(startTime) : null,
            endTime ? parseFloat(endTime) : null,
            removeSilence !== 'no'
        );

        res.redirect(`/download/${filePath}`);
    } catch (error) {
        console.error('Error during download and conversion:', error);
        res.status(500).send('Error during download and conversion.');
    }
});
*/