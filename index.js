const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

// ==========================================
// FIREBASE
// ==========================================

const FIREBASE_URL = process.env.FIREBASE_URL;

// ==========================================
// SETTINGS
// ==========================================

const SESSION_FOLDER = path.join(__dirname, "session_data");
const QR_FILE = path.join(__dirname, "qr.png");

// User order states
const orderStates = {};

// ==========================================
// CREATE FOLDERS
// ==========================================

if (!fs.existsSync(SESSION_FOLDER)) {
    fs.mkdirSync(SESSION_FOLDER, {
        recursive: true
    });
}

// ==========================================
// FIREBASE MENU
// ==========================================

async function getMenuFromApp() {
    try {
        if (!FIREBASE_URL) {
            console.log("❌ FIREBASE_URL missing");
            return [];
        }

        const response = await fetch(
            `${FIREBASE_URL}/dishes.json`
        );

        if (!response.ok) {
            console.log(
                "❌ Firebase menu error:",
                response.status
            );

            return [];
        }

        const data = await response.json();

        if (!data) {
            return [];
        }

        return Object.keys(data).map(key => ({
            id: key,
            name: data[key].name || "Unknown Item",
            price: data[key].price || 0,
            imageUrl: data[key].imageUrl || ""
        }));

    } catch (error) {

        console.log(
            "❌ Failed to fetch menu:",
            error.message
        );

        return [];
    }
}

// ==========================================
// CREATE QR PNG
// ==========================================

async function createQRImage(qr) {

    try {

        // Delete old QR
        if (fs.existsSync(QR_FILE)) {
            fs.unlinkSync(QR_FILE);
        }

        // Create new PNG
        await QRCode.toFile(
            QR_FILE,
            qr,
            {
                width: 1000,
                margin: 4,
                errorCorrectionLevel: "H"
            }
        );

        console.log("");
        console.log("==========================================");
        console.log("📱 NEW WHATSAPP QR CREATED");
        console.log("==========================================");
        console.log(`📁 QR FILE: ${QR_FILE}`);
        console.log("📸 Open qr.png and scan it with WhatsApp");
        console.log("==========================================");
        console.log("");

    } catch (error) {

        console.log(
            "❌ QR PNG ERROR:",
            error.message
        );

    }
}

// ==========================================
// DELETE QR AFTER CONNECTION
// ==========================================

function deleteQR() {

    try {

        if (fs.existsSync(QR_FILE)) {

            fs.unlinkSync(QR_FILE);

            console.log("🗑️ Old QR deleted");

        }

    } catch (error) {

        console.log(
            "QR delete error:",
            error.message
        );

    }
}

// ==========================================
// START WHATSAPP BOT
// ==========================================

async function startBot() {

    try {

        if (!FIREBASE_URL) {

            console.log("");
            console.log("❌ ERROR");
            console.log("FIREBASE_URL is missing!");
            console.log("");
            console.log(
                "GitHub Secrets → FIREBASE_URL add karo."
            );

            process.exit(1);
        }

        console.log("");
        console.log("==========================================");
        console.log("🤖 HAROONXAGENT STARTING");
        console.log("==========================================");
        console.log("");

        // ======================================
        // AUTH STATE
        // ======================================

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(
            SESSION_FOLDER
        );

        // ======================================
        // BAILEYS VERSION
        // ======================================

        const {
            version
        } = await fetchLatestBaileysVersion();

        console.log(
            `📦 WhatsApp Version: ${version.join(".")}`
        );

        // ======================================
        // CREATE SOCKET
        // ======================================

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
                "1.0.0"
            ],

            markOnlineOnConnect: true

        });

        // ======================================
        // SAVE CREDENTIALS
        // ======================================

        sock.ev.on(
            "creds.update",
            saveCreds
        );

        // ======================================
        // CONNECTION UPDATE
        // ======================================

        sock.ev.on(
            "connection.update",
            async (update) => {

                const {
                    connection,
                    lastDisconnect,
                    qr
                } = update;

                // ==================================
                // NEW QR
                // ==================================

                if (qr) {

                    await createQRImage(qr);

                }

                // ==================================
                // CONNECTED
                // ==================================

                if (connection === "open") {

                    deleteQR();

                    console.log("");
                    console.log(
                        "=========================================="
                    );
                    console.log(
                        "✅ WHATSAPP CONNECTED SUCCESSFULLY"
                    );
                    console.log(
                        "🤖 HAROONXAGENT IS ONLINE"
                    );
                    console.log(
                        "=========================================="
                    );
                    console.log("");

                }

                // ==================================
                // CONNECTION CLOSED
                // ==================================

                if (connection === "close") {

                    const statusCode =
                        lastDisconnect
                            ?.error
                            ?.output
                            ?.statusCode;

                    console.log("");
                    console.log(
                        "⚠️ WhatsApp connection closed"
                    );

                    console.log(
                        "Status:",
                        statusCode
                    );

                    // Logged out permanently
                    if (
                        statusCode ===
                        DisconnectReason.loggedOut
                    ) {

                        console.log("");
                        console.log(
                            "❌ WhatsApp logged out."
                        );

                        console.log(
                            "Delete session_data and scan QR again."
                        );

                        return;
                    }

                    // Temporary disconnect
                    console.log(
                        "🔄 Reconnecting in 5 seconds..."
                    );

                    setTimeout(() => {

                        startBot();

                    }, 5000);
                }

            }
        );

        // ======================================
        // INCOMING MESSAGES
        // ======================================

        sock.ev.on(
            "messages.upsert",
            async (m) => {

                try {

                    const msg = m.messages[0];

                    if (!msg) {
                        return;
                    }

                    // No message
                    if (!msg.message) {
                        return;
                    }

                    // Ignore WhatsApp status
                    if (
                        msg.key.remoteJid ===
                        "status@broadcast"
                    ) {
                        return;
                    }

                    // Ignore our own messages
                    if (msg.key.fromMe) {
                        return;
                    }

                    const sender =
                        msg.key.remoteJid;

                    // ==================================
                    // GET MESSAGE TEXT
                    // ==================================

                    const text = (

                        msg.message.conversation ||

                        msg.message.extendedTextMessage
                            ?.text ||

                        msg.message.imageMessage
                            ?.caption ||

                        ""

                    ).trim().toLowerCase();

                    console.log("");
                    console.log(
                        `📩 Message: ${text}`
                    );

                    console.log(
                        `👤 From: ${sender}`
                    );

                    // ==================================
                    // EMPTY MESSAGE
                    // ==================================

                    if (!text) {
                        return;
                    }

                    // ==================================
                    // WAITING FOR ADDRESS
                    // ==================================

                    if (
                        orderStates[sender]
                            ?.step ===
                        "WAITING_FOR_ADDRESS"
                    ) {

                        const customerDetails =
                            text;

                        const item =
                            orderStates[sender].item;

                        const customerWaNumber =
                            sender.split("@")[0];

                        const itemPrice =
                            parseFloat(
                                item.price
                            ) || 0;

                        const deliveryCharge = 50;

                        const total =
                            itemPrice +
                            deliveryCharge;

                        // ==================================
                        // ORDER OBJECT
                        // ==================================

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
                                    id:
                                        item.id,

                                    name:
                                        item.name,

                                    price:
                                        itemPrice,

                                    img:
                                        item.imageUrl ||
                                        "",

                                    quantity: 1
                                }
                            ],

                            total:
                                total.toFixed(2),

                            status:
                                "Placed",

                            method:
                                "Cash on Delivery (WhatsApp)",

                            timestamp:
                                new Date().toISOString()
                        };

                        // ==================================
                        // SAVE ORDER TO FIREBASE
                        // ==================================

                        try {

                            const response =
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

                            if (!response.ok) {

                                throw new Error(
                                    `Firebase returned ${response.status}`
                                );

                            }

                            console.log(
                                "✅ Order saved to Firebase"
                            );

                        } catch (error) {

                            console.log(
                                "❌ Firebase Order Error:",
                                error.message
                            );

                        }

                        // ==================================
                        // SEND CONFIRMATION
                        // ==================================

                        await sock.sendMessage(
                            sender,
                            {
                                text:
                                    `✅ *Order Placed Successfully!*\n\n` +

                                    `Thank you! Your order for *${item.name}* is being prepared.\n\n` +

                                    `*Item Price:* ₹${itemPrice}\n` +

                                    `*Delivery:* ₹${deliveryCharge}\n` +

                                    `*Total:* ₹${total.toFixed(2)}\n\n` +

                                    `*Status:* Preparing\n\n` +

                                    `We will deliver your order to the provided address soon.`
                            }
                        );

                        // Clear order state
                        delete orderStates[sender];

                        return;
                    }

                    // ==================================
                    // ORDER COMMAND
                    // ==================================

                    if (
                        text.startsWith("order ")
                    ) {

                        const productRequested =
                            text
                                .replace(
                                    "order ",
                                    ""
                                )
                                .trim()
                                .toLowerCase();

                        if (!productRequested) {

                            await sock.sendMessage(
                                sender,
                                {
                                    text:
                                        "❌ Please type a food name.\n\nExample:\n*order pizza*"
                                }
                            );

                            return;
                        }

                        // Get current menu
                        const currentMenu =
                            await getMenuFromApp();

                        // Find item
                        const matchedItem =
                            currentMenu.find(
                                item =>
                                    item.name
                                        .toLowerCase()
                                        .includes(
                                            productRequested
                                        )
                            );

                        // Product not found
                        if (!matchedItem) {

                            await sock.sendMessage(
                                sender,
                                {
                                    text:
                                        `❌ Sorry, we couldn't find *${productRequested}* in our menu today.\n\n` +
                                        `Type *menu* to see all available items.`
                                }
                            );

                            return;
                        }

                        // Save order state
                        orderStates[sender] = {

                            step:
                                "WAITING_FOR_ADDRESS",

                            item:
                                matchedItem

                        };

                        // ==================================
                        // ORDER MESSAGE
                        // ==================================

                        const captionText =
                            `🛒 *Order Started!*\n\n` +

                            `You selected: *${matchedItem.name}*\n` +

                            `Price: ₹${matchedItem.price}\n\n` +

                            `Please reply with your *Full Name, Phone Number, and Delivery Address*.`;

                        // ==================================
                        // SEND IMAGE OR TEXT
                        // ==================================

                        if (
                            matchedItem.imageUrl
                        ) {

                            try {

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

                            } catch (error) {

                                console.log(
                                    "Image send failed:",
                                    error.message
                                );

                                await sock.sendMessage(
                                    sender,
                                    {
                                        text:
                                            captionText
                                    }
                                );

                            }

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

                    // ==================================
                    // ONLY "ORDER"
                    // ==================================

                    if (
                        text === "order"
                    ) {

                        await sock.sendMessage(
                            sender,
                            {
                                text:
                                    `🛒 *How to order:*\n\n` +

                                    `Please type:\n` +

                                    `*order [dish name]*\n\n` +

                                    `Example:\n` +

                                    `*order pizza*`
                            }
                        );

                        return;
                    }

                    // ==================================
                    // MENU
                    // ==================================

                    if (
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
                                        "⚠️ Our menu is currently empty or updating.\n\nPlease check back soon."
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
                            "\n📌 To order, type:\n";

                        menuMessage +=
                            "*order [dish name]*";

                        await sock.sendMessage(
                            sender,
                            {
                                text:
                                    menuMessage
                            }
                        );

                        return;
                    }

                    // ==================================
                    // HELLO
                    // ==================================

                    if (
                        text.includes("hi") ||
                        text.includes("hello") ||
                        text.includes("hey")
                    ) {

                        await sock.sendMessage(
                            sender,
                            {
                                text:
                                    `👋 *Welcome to Haroonworld!*\n\n` +

                                    `I am your AI Assistant.\n\n` +

                                    `🍔 Type *menu* to see our delicious food.\n\n` +

                                    `🛒 Type *order [dish]* to buy instantly.`
                            }
                        );

                        return;
                    }

                    // ==================================
                    // CONTACT
                    // ==================================

                    if (
                        text.includes("contact") ||
                        text.includes("call")
                    ) {

                        await sock.sendMessage(
                            sender,
                            {
                                text:
                                    `📞 *Contact Haroonxagent*\n\n` +

                                    `📧 Email:\n` +

                                    `support haroonminhasb9t2@gmail.com`
                            }
                        );

                        return;
                    }

                    // ==================================
                    // DEFAULT REPLY
                    // ==================================

                    await sock.sendMessage(
                        sender,
                        {
                            text:
                                `🤔 I didn't quite catch that.\n\n` +

                                `Type *menu* to see our food list.\n\n` +

                                `Or type *order [food]* to place an order.`
                        }
                    );

                } catch (error) {

                    console.log(
                        "❌ Message Handler Error:",
                        error.message
                    );

                }

            }
        );

    } catch (error) {

        console.log("");
        console.log(
            "❌ BOT START ERROR:"
        );

        console.log(
            error
        );

        console.log("");
        console.log(
            "🔄 Retrying in 10 seconds..."
        );

        setTimeout(() => {

            startBot();

        }, 10000);
    }
}

// ==========================================
// START
// ==========================================

startBot();
