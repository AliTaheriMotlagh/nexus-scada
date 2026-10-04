// Usage: npm run hash-password -w server -- <password>
import { hashPassword } from '../security/AuthService.ts';

const password = process.argv[2];
if (!password) {
  console.error('usage: hash-password <password>');
  process.exit(1);
}
console.log(hashPassword(password));
