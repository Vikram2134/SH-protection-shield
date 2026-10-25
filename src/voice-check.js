const {generateDependencyReport}=require('@discordjs/voice');
const ffmpeg=require('ffmpeg-static');
console.log(generateDependencyReport());
console.log('Bundled FFmpeg:',ffmpeg||'NOT FOUND');
console.log('AES-256-GCM:',require('node:crypto').getCiphers().includes('aes-256-gcm'));
