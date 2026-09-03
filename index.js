const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');

// ⚠️ YAHAN APNA WHATSAPP NUMBER LIKHEIN (Country code ke saath, bina '+' ya space ke)
// Example for Pakistan: "923001234567"
const PHONE_NUMBER = "923195653021"; 

async function startBot() {
    // Session state management
    const { state, saveCreds } = await useMultiFileAuthState('session');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // QR terminal par print nahi hoga
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // Agar session pehle se registered nahi hai toh Pairing Code request karein
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                console.log("\n==========================================");
                console.log(`🔑 YOUR WHATSAPP PAIRING CODE: ${code}`);
                console.log("==========================================\n");
            } catch (err) {
                console.error("Pairing code generate karne me masla aaya:", err);
            }
        }, 3000);
    }

    // Credentials update handler
    sock.ev.on('creds.update', saveCreds);

    // Connection update handler
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot successfully connected!');
        }
    });

    // Messages handler
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        console.log(`Message received from ${msg.key.remoteJid}:`, msg.message);
    });
}

startBot();
