import fs from 'node:fs';
import bcrypt from 'bcryptjs';

export const loadUsers = (path) => {
    const raw = fs.readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${path} must be a JSON object of {username: bcryptHash}.`);
    }
    for (const [user, hash] of Object.entries(parsed)) {
        if (typeof hash !== 'string' || !hash.startsWith('$2')) {
            throw new Error(`User "${user}" in ${path} does not have a bcrypt hash. Use \`npm run hashpw <password>\` to generate one.`);
        }
    }
    return parsed;
};

export const createAuth = (users) => ({
    async verify(username, password) {
        const hash = users[username];
        if (!hash) return false;
        return bcrypt.compare(password || '', hash);
    },
});
