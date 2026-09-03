const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');

const PHONE_NUMBER = "923195653021"; 

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    let pairingInterval = null;

    // Pairing code request function
    const requestCode = async () => {
        if (!sock.authState.creds.registered) {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                console.log("\n==========================================");
                console.log(`🔑 NEW WHATSAPP PAIRING CODE: ${code}`);
                console.log("==========================================\n");
            } catch (err) {
                console.error("Pairing code error:", err?.message || err);
            }
        }
    };

    // Agar register nahi hai toh har 30 second baad naya code mangayein
    if (!sock.authState.creds.registered) {
        setTimeout(requestCode, 3000); // Pehla code 3 sec baad
        pairingInterval = setInterval(requestCode, 30000); // Har 30 sec baad naya code
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log('✅ WhatsApp Bot successfully connected!');
            if (pairingInterval) clearInterval(pairingInterval); // Connect hone par loop stop ho jayega
        } else if (connection === 'close') {
            if (pairingInterval) clearInterval(pairingInterval);
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        console.log(`Message received from ${msg.key.remoteJid}:`, msg.message);
    });
}

startBot();
