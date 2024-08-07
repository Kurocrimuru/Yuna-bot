const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const Groq = require('groq-sdk');
const axios = require('axios');
const FormData = require('form-data');


// Load environment variables from .env file
dotenv.config();

// Inisialisasi WhatsApp client dengan LocalAuth untuk menyimpan sesi lokal
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "client-one" 
    }),
    restartOnCrash: true
});

// Generate QR code untuk login pertama kali
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('QR code generated. Please scan it.');
});

client.on('authenticated', (session) => {
    console.log('Authenticated');
});

client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
});

client.on('ready', () => {
    console.log('Client is ready!');
});

// Inisialisasi Groq client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Fungsi untuk membaca memori dari conversation.json
async function readMemory() {
    const filePath = path.join(__dirname, 'conversation.json');
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const data = fs.readFileSync(filePath);
    return JSON.parse(data);
}

// Fungsi untuk menulis memori ke conversation.json
async function writeMemory(memory) {
    const filePath = path.join(__dirname, 'conversation.json');
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2));
}

// Fungsi untuk membersihkan teks
function cleanText(text) {
    console.log(`Teks asli sebelum pembersihan: ${text}`);
    
    // Menghapus karakter dan kata yang tidak diinginkan
    let cleanedText = text
        .replace(/\*/g, '')
        .replace(/wink/g, '')
        .replace(/smiles/g, '')
        .replace(/English translation/g, '')
        .replace(/"/g, '')
        .replace(/Ah/g, '');
    
    console.log(`Teks setelah pembersihan: ${cleanedText}`);
    
    return cleanedText;
}

// Contoh penggunaan
const originalText = 'Example text with *wink* and smiles. English translation "😊" Ah.';
const cleanedText = cleanText(originalText);
console.log(cleanedText);


// Fungsi untuk mendapatkan respon dari Groq AI
async function getGroqResponse(userMessage) {
    try {
        const context = "Nama kamu Yuna, AI cewek yang cuek. Balas pesan dengan singkat dan pakai bahasa gaul. Selalu respon dengan bahasa Indonesia.";
        const messages = [
            { role: "system", content: context }
        ];

        // Baca memori dari conversation.json
        const memory = await readMemory();

        for (let item of memory) {
            messages.push({ role: "user", content: item.user });
            messages.push({ role: "assistant", content: item.assistant });
        }

        messages.push({ role: "user", content: userMessage });

        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: "llama3-8b-8192",
            max_tokens: 50
        });

        const aiResponse = chatCompletion.choices[0]?.message?.content || 'Maaf, saya mengalami masalah dalam memahami pesan Anda.';

        // Tambahkan percakapan terbaru ke memori
        memory.push({ user: userMessage, assistant: aiResponse });

        // Batasi memori sampai 10 obrolan
        if (memory.length > 10) {
            memory.shift();
        }

        // Tulis memori terbaru ke conversation.json
        await writeMemory(memory);

        return aiResponse;
    } catch (error) {
        console.error('Error getting response from Groq:', error);
        return 'Maaf, saya mengalami masalah dalam memahami pesan Anda.';
    }
}

// Fungsi untuk melakukan TTS menggunakan gtts
async function getGTTSTTS(text) {
    try {
        const gttsInstance = new gtts(text, 'id');
        const filePath = path.join(__dirname, 'audio', 'response.mp3');
        
        await new Promise((resolve, reject) => {
            gttsInstance.save(filePath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        return filePath;
    } catch (error) {
        console.error('Error generating TTS:', error);
        return null;
    }
}

// Fungsi untuk menghasilkan gambar dengan Stability AI
async function generateImage(prompt) {
    try {
        const payload = {
            prompt: prompt,
            output_format: 'webp' // Ubah format jika diperlukan
        };

        const form = new FormData();
        for (const key in payload) {
            form.append(key, payload[key]);
        }

        const response = await axios.post(
            'https://api.stability.ai/v2beta/stable-image/generate/ultra',
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
                    Accept: 'image/*'
                },
                responseType: 'arraybuffer'
            }
        );

        if (response.status === 200) {
            const filePath = path.join(__dirname, 'images', 'generated_image.webp');
            fs.writeFileSync(filePath, Buffer.from(response.data));
            return filePath;
        } else {
            throw new Error(`${response.status}: ${response.data.toString()}`);
        }
    } catch (error) {
        console.error('Error generating image:', error);
        return null;
    }
}

// Fungsi untuk menangani pesan
client.on('message', async message => {
    if (message.type === 'audio') {
        // Simpan file audio
        const filePath = path.join(__dirname, 'audio', 'audio.ogg');
        await message.downloadMedia();
        fs.writeFileSync(filePath, message.media.data, 'base64');

        // Kirim pesan teks ke pengguna
        message.reply('Maaf, saat ini saya belum bisa memproses pesan suara.');

    } else if (message.type === 'chat') {
        const userMessage = message.body;

        // Jika pesan dimulai dengan "generate image"
        if (userMessage.toLowerCase().startsWith('generate image')) {
            const prompt = userMessage.substring('generate image'.length).trim();
            const imagePath = await generateImage(prompt);

            if (imagePath) {
                const image = MessageMedia.fromFilePath(imagePath);
                await client.sendMessage(message.from, image);
            } else {
                message.reply('Maaf, saya mengalami masalah dalam menghasilkan gambar.');
            }

        } else {
            // Dapatkan respon dari AI menggunakan Groq
            const groqResponse = await getGroqResponse(userMessage);

            // Dapatkan path file TTS dari teks yang dihasilkan
            const ttsPath = await getGTTSTTS(groqResponse);

            // Kirim pesan teks ke pengguna
            message.reply(groqResponse);

            // Jika file audio berhasil dibuat, kirimkan juga
            if (ttsPath) {
                const audio = MessageMedia.fromFilePath(ttsPath);
                client.sendMessage(message.from, audio);
            } else {
                console.log('Gagal menghasilkan file audio.');
            }
        }
    }
});

client.initialize();
