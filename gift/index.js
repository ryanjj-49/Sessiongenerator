const fs = require('fs');

function giftedId(num = 4) {
    let result = "";
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < num; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function generateRandomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    await fs.promises.rm(FilePath, { recursive: true, force: true });
    return true;
}

const safeGroupAcceptInvite = async (Gifted, groupJid) => {
    if (!groupJid) return false;
    try {
        await Gifted.groupAcceptInvite(groupJid);
        return true;
    } catch (error) {
        switch (error.data) {
            case 409: console.log(`Already in group: ${groupJid}`); break;
            case 400: console.log(`Invalid invite code for group: ${groupJid}`); break;
            case 403: console.log(`No permission to join group: ${groupJid}`); break;
            default:  console.error(`Group join failed for ${groupJid}:`, error.message);
        }
        return false;
    }
};

module.exports = { giftedId, removeFile, generateRandomCode, safeGroupAcceptInvite };
