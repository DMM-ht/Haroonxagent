const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const QRCode = require('qrcode');
const express = require('express');
const localtunnel = require('localtunnel');
const crypto = require('crypto');

// ===============================
// CONFIG
// ===============================

const FIREBASE_URL = process.env.FIREBASE_URL;
const PORT = 3000;

// Random URL token
const QR_TOKEN = crypto.randomBytes(16).toString('hex');

const orderStates = {};

let currentQR = null;
let botSocket = null;

// ===============================
// WEB SERVER
// ===============================

const app = express();

app.get(`/qr/${QR_TOKEN}`, (req, res) => {

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width,
               initial-scale=1.0,
               maximum-scale=1.0,
               user-scalable=no">

<title>WhatsApp Bot QR</title>

<style>

* {
    box-sizing: border-box;
}

html,
body {
    margin: 0;
    padding: 0;

    width: 100%;
    height: 100%;

    overflow: hidden;

    font-family: Arial, sans-serif;

    background: #111;
}

body {
    display: flex;

    justify-content: center;
    align-items: center;
}

.container {

    width: 100vw;
    height: 100vh;

    display: flex;

    flex-direction: column;

    justify-content: center;
    align-items: center;

    padding: 20px;
}

h1 {
    color: white;

    font-size: 28px;

    margin: 0 0 10px 0;
}

.status {

    color: #bbb;

    font-size: 16px;

    margin-bottom: 20px;

    text-align: center;
}

.qr-box {

    width: min(80vw, 420px);
    height: min(80vw, 420px);

    background: white;

    border-radius: 20px;

    padding: 20px;

    display: flex;

    justify-content: center;
    align-items: center;

    box-shadow:
        0 0 30px rgba(255,255,255,0.15);
}

#qr {

    width: 100%;
    height: 100%;

    object-fit: contain;

    image-rendering: pixelated;
}

.instructions {

    color: #ddd;

    text-align: center;

    margin-top: 20px;

    font-size: 15px;

    line-height: 1.6;
}

#connected {

    display: none;

    color: #7CFF8A;

    font-size: 22px;

    font-weight: bold;
}

</style>

</head>

<body>

<div class="container">

    <h1>📱 WhatsApp Bot</h1>

    <div class="status" id="status">
        Waiting for QR Code...
    </div>

    <div class="qr-box">

        <img
            id="qr"
            alt="WhatsApp QR Code"
        >

    </div>

    <div class="instructions">

        WhatsApp کھولیں<br>
        Linked Devices → Link a device<br>
        پھر اس QR Code کو scan کریں

    </div>

    <div id="connected">
        ✅ WhatsApp Connected
    </div>

</div>

<script>

const qrImage = document.getElementById("qr");
const statusText = document.getElementById("status");
const connectedText = document.getElementById("connected");

function showQR(data) {

    qrImage.src = data;

    qrImage.style.display = "block";

    statusText.innerText =
        "Scan this QR with WhatsApp";

}

function connected() {

    qrImage.style.display = "none";

    statusText.style.display = "none";

    connectedText.style.display = "block";

}

// Server سے live updates
const events = new EventSource("/events");

events.onmessage = function(event) {

    const data = JSON.parse(event.data);

    if (data.type === "qr") {

        showQR(data.qr);

    }

    if (data.type === "connected") {

        connected();

    }

};

</script>

</body>
</html>
    `);

});

// ===============================
// SSE CONNECTIONS
// ===============================

let clients = [];

app.get("/events", (req, res) => {

    res.setHeader(
        "Content-Type",
        "text/event-stream"
    );

    res.setHeader(
        "Cache-Control",
        "no-cache"
    );

    res.setHeader(
        "Connection",
        "keep-alive"
    );

    res.flushHeaders();

    clients.push(res);

    // اگر QR پہلے سے موجود ہے
    if (currentQR) {

        res.write(
            `data: ${JSON.stringify({
                type: "qr",
                qr: currentQR
            })}\n\n`
        );

    }

    req.on("close", () => {

        clients = clients.filter(
            client => client !== res
        );

    });

});

function broadcast(data) {

    const message =
        `data: ${JSON.stringify(data)}\n\n`;

    clients.forEach(client => {

        try {

            client.write(message);

        } catch (error) {

            console.log("SSE client error");

        }

    });

}

// ===============================
// START WEB SERVER
// ===============================

app.listen(PORT, async () => {

    console.log("");
    console.log("==========================================");
    console.log("🌐 QR WEB SERVER STARTED");
    console.log(`Port: ${PORT}`);
    console.log("==========================================");

    try {

        const tunnel = await localtunnel({
            port: PORT
        });

        const qrURL =
            `${tunnel.url}/qr/${QR_TOKEN}`;

        console.log("");
        console.log("==========================================");
        console.log("📱 WHATSAPP QR PAGE");
        console.log("==========================================");
        console.log(qrURL);
        console.log("==========================================");
        console.log("");

    } catch (error) {

        console.log(
            "❌ Tunnel Error:",
            error.message
        );

    }

});

// ===============================
// FIREBASE MENU
// ===============================

async function getMenuFromApp() {

    try {

        const response =
            await fetch(
                `${FIREBASE_URL}/dishes.json`
            );

        const data =
            await response.json();

        if (!data) return [];

        return Object.keys(data).map(key => ({

            id: key,

            name: data[key].name,

            price: data[key].price,

            imageUrl: data[key].imageUrl

        }));

    } catch (error) {

        console.error(
            "Failed to fetch menu:",
            error
        );

        return [];

    }

}

// ===============================
// START BOT
// ===============================

async function startBot() {

    if (!FIREBASE_URL) {

        console.log(
            "❌ ERROR: FIREBASE_URL is missing!"
        );

        process.exit(1);

    }

    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(
        "session_data"
    );

    const {
        version
    } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({

        version,

        auth: state,

        printQRInTerminal: false,

        logger: pino({
            level: "silent"
        }),

        browser: [
            "Haroonxagent",
            "Chrome",
            "1.0"
        ]

    });

    botSocket = sock;

    // ===============================
    // CONNECTION UPDATE
    // ===============================

    sock.ev.on(
        "connection.update",
        async update => {

            const {
                connection,
                lastDisconnect,
                qr
            } = update;

            // NEW QR
            if (qr) {

                console.log("");
                console.log(
                    "📱 NEW WHATSAPP QR GENERATED"
                );

                try {

                    currentQR =
                        await QRCode.toDataURL(
                            qr,
                            {
                                width: 800,
                                margin: 4,
                                errorCorrectionLevel: "M"
                            }
                        );

                    broadcast({

                        type: "qr",

                        qr: currentQR

                    });

                    console.log(
                        "✅ QR sent to browser"
                    );

                } catch (error) {

                    console.log(
                        "QR generation error:",
                        error
                    );

                }

            }

            // CONNECTED
            if (connection === "open") {

                console.log("");
                console.log(
                    "=========================================="
                );
                console.log(
                    "✅ JAVAGOAT AI IS ONLINE!"
                );
                console.log(
                    "=========================================="
                );

                currentQR = null;

                broadcast({

                    type: "connected"

                });

            }

            // DISCONNECTED
            if (connection === "close") {

                const reason =
                    lastDisconnect
                        ?.error
                        ?.output
                        ?.statusCode;

                console.log(
                    "WhatsApp connection closed:",
                    reason
                );

                if (
                    reason !==
                    DisconnectReason.loggedOut
                ) {

                    console.log(
                        "🔄 Reconnecting..."
                    );

                    setTimeout(
                        startBot,
                        3000
                    );

                } else {

                    console.log(
                        "❌ WhatsApp logged out."
                    );

                }

            }

        }
    );

    sock.ev.on(
        "creds.update",
        saveCreds
    );

    // ===============================
    // MESSAGES
    // ===============================

    sock.ev.on(
        "messages.upsert",
        async m => {

            const msg = m.messages[0];

            if (
                !msg.message ||
                msg.key.remoteJid ===
                "status@broadcast"
            ) return;

            if (msg.key.fromMe) return;

            const sender =
                msg.key.remoteJid;

            const text =
                (
                    msg.message.conversation ||
                    msg.message.extendedTextMessage?.text ||
                    ""
                ).toLowerCase();

            console.log(
                `📩 Query: ${text}`
            );

            // ===============================
            // FINISH ORDER
            // ===============================

            if (
                orderStates[sender]
                    ?.step ===
                "WAITING_FOR_ADDRESS"
            ) {

                const customerDetails = text;

                const item =
                    orderStates[sender].item;

                const customerWaNumber =
                    sender.split("@")[0];

                const javaGoatOrder = {

                    userId:
                        "whatsapp_" +
                        customerWaNumber,

                    userEmail:
                        "whatsapp@javagoat.com",

                    phone:
                        customerWaNumber,

                    address:
                        customerDetails,

                    location: {
                        lat: 0,
                        lng: 0
                    },

                    items: [
                        {
                            id: item.id,

                            name: item.name,

                            price:
                                parseFloat(
                                    item.price
                                ),

                            img:
                                item.imageUrl || "",

                            quantity: 1
                        }
                    ],

                    total:
                        (
                            parseFloat(item.price) +
                            50
                        ).toFixed(2),

                    status:
                        "Placed",

                    method:
                        "Cash on Delivery (WhatsApp)",

                    timestamp:
                        new Date().toISOString()

                };

                try {

                    await fetch(
                        `${FIREBASE_URL}/orders.json`,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify(
                                    javaGoatOrder
                                )
                        }
                    );

                } catch (error) {

                    console.log(
                        "Firebase Error:",
                        error
                    );

                }

                await sock.sendMessage(
                    sender,
                    {
                        text:
`✅ *Order Placed Successfully!*

Thank you! Your order for *${item.name}* is being prepared.

*Total:* ₹${javaGoatOrder.total} (Inc. Delivery)
*Status:* Preparing

We will deliver it to your address soon.`
                    }
                );

                delete orderStates[sender];

                return;

            }

            // ===============================
            // ORDER
            // ===============================

            if (
                text.startsWith("order ")
            ) {

                const productRequested =
                    text
                        .replace("order ", "")
                        .trim()
                        .toLowerCase();

                const currentMenu =
                    await getMenuFromApp();

                const matchedItem =
                    currentMenu.find(
                        item =>
                            item.name
                                .toLowerCase()
                                .includes(
                                    productRequested
                                )
                    );

                if (!matchedItem) {

                    await sock.sendMessage(
                        sender,
                        {
                            text:
`❌ Sorry, we couldn't find *${productRequested}* in our menu today.

Type *menu* to see all available items.`
                        }
                    );

                    return;

                }

                orderStates[sender] = {

                    step:
                        "WAITING_FOR_ADDRESS",

                    item:
                        matchedItem

                };

                const captionText =
`🛒 *Order Started!*

You selected: *${matchedItem.name}* (₹${matchedItem.price})

Please reply with your *Full Name, Phone Number, and Delivery Address*.`;

                if (
                    matchedItem.imageUrl
                ) {

                    await sock.sendMessage(
                        sender,
                        {
                            image: {
                                url:
                                    matchedItem.imageUrl
                            },

                            caption:
                                captionText
                        }
                    );

                } else {

                    await sock.sendMessage(
                        sender,
                        {
                            text:
                                captionText
                        }
                    );

                }

                return;

            }

            // ===============================
            // ORDER HELP
            // ===============================

            else if (
                text === "order"
            ) {

                await sock.sendMessage(
                    sender,
                    {
                        text:
`🛒 *How to order:*

Please type 'order' followed by the dish name.

Example:
*order pizza*`
                    }
                );

                return;

            }

            // ===============================
            // MENU
            // ===============================

            else if (
                text.includes("menu") ||
                text.includes("price") ||
                text.includes("list") ||
                text.includes("food")
            ) {

                const currentMenu =
                    await getMenuFromApp();

                if (
                    currentMenu.length === 0
                ) {

                    await sock.sendMessage(
                        sender,
                        {
                            text:
                                "Our menu is currently empty or updating. Please check back soon!"
                        }
                    );

                    return;

                }

                let menuMessage =
                    "🍔 *JAVAGOAT LIVE MENU* 🍕\n\n";

                currentMenu.forEach(
                    item => {

                        menuMessage +=
`🔸 *${item.name}* - ₹${item.price}\n`;

                    }
                );

                menuMessage +=
                    "\n_To order, reply with 'order [dish name]'_";

                await sock.sendMessage(
                    sender,
                    {
                        text:
                            menuMessage
                    }
                );

                return;

            }

            // ===============================
            // GREETING
            // ===============================

            else if (
                text.includes("hi") ||
                text.includes("hello") ||
                text.includes("hey")
            ) {

                await sock.sendMessage(
                    sender,
                    {
                        text:
`👋 *Welcome to Haroonworld!*

I am your AI Assistant.

Type *menu* to see our delicious food, or type *order [dish]* to buy instantly!`
                    }
                );

                return;

            }

            // ===============================
            // CONTACT
            // ===============================

            else if (
                text.includes("contact") ||
                text.includes("call")
            ) {

                await sock.sendMessage(
                    sender,
                    {
                        text:
`📞 *Contact Haroonxagent:*

- *Email:* support haroonminhasb9t2@gmail.com`
                    }
                );

                return;

            }

            // ===============================
            // DEFAULT
            // ===============================

            else {

                await sock.sendMessage(
                    sender,
                    {
                        text:
`🤔 I didn't quite catch that.

Type *menu* to see our food list, or *order [food]* to place an order!`
                    }
                );

            }

        }
    );

}

// ===============================
// START
// ===============================

startBot().catch(
    err =>
        console.log(
            "Error:",
            err
        )
);
