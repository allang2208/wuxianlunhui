import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const frameCount = 16;
const delayNumerator = 1;
const delayDenominator = 12;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
    return Buffer.concat([length, typeBuffer, data, crc]);
}

function parsePng(filePath) {
    const buffer = fs.readFileSync(filePath);
    if (!buffer.subarray(0, 8).equals(signature)) throw new Error(`${filePath} is not a PNG`);
    const chunks = [];
    let offset = 8;
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        chunks.push({ type, data });
        offset += 12 + length;
    }
    return chunks;
}

const parsedFrames = Array.from({ length: frameCount }, (_, index) => {
    const filePath = path.join(root, `candidate_v2_frame_${String(index).padStart(2, '0')}.png`);
    const chunks = parsePng(filePath);
    const ihdr = chunks.find((item) => item.type === 'IHDR')?.data;
    const idat = chunks.filter((item) => item.type === 'IDAT').map((item) => item.data);
    if (!ihdr || idat.length === 0) throw new Error(`missing IHDR/IDAT in ${filePath}`);
    return { ihdr, idat };
});

const ihdr = parsedFrames[0].ihdr;
const width = ihdr.readUInt32BE(0);
const height = ihdr.readUInt32BE(4);
const outputChunks = [signature, chunk('IHDR', ihdr)];
const animationControl = Buffer.alloc(8);
animationControl.writeUInt32BE(frameCount, 0);
animationControl.writeUInt32BE(0, 4);
outputChunks.push(chunk('acTL', animationControl));

let sequence = 0;
for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence++, 0);
    control.writeUInt32BE(width, 4);
    control.writeUInt32BE(height, 8);
    control.writeUInt32BE(0, 12);
    control.writeUInt32BE(0, 16);
    control.writeUInt16BE(delayNumerator, 20);
    control.writeUInt16BE(delayDenominator, 22);
    control.writeUInt8(0, 24);
    control.writeUInt8(0, 25);
    outputChunks.push(chunk('fcTL', control));

    for (const imageData of parsedFrames[frameIndex].idat) {
        if (frameIndex === 0) {
            outputChunks.push(chunk('IDAT', imageData));
        } else {
            const frameData = Buffer.alloc(4 + imageData.length);
            frameData.writeUInt32BE(sequence++, 0);
            imageData.copy(frameData, 4);
            outputChunks.push(chunk('fdAT', frameData));
        }
    }
}
outputChunks.push(chunk('IEND', Buffer.alloc(0)));

const outputPath = path.join(root, 'windmill_original_perspective_rotation_v2_preview.png');
fs.writeFileSync(outputPath, Buffer.concat(outputChunks));
console.log(`${outputPath} (${width}x${height}, ${frameCount} frames, ${delayDenominator} fps)`);
