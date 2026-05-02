#!/usr/bin/env node
import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password) {
    console.error('Usage: node bin/hashpw.js <password>');
    process.exit(2);
}

const hash = bcrypt.hashSync(password, 10);
process.stdout.write(hash + '\n');
