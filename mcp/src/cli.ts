import { Account } from './auth/account.js';

/** Admin commands, run with: docker exec -it aisidian-mcp node dist/cli.js <command> */
async function main(): Promise<void> {
  const cmd = process.argv[2];
  const stateDir = process.env.STATE_DIR ?? '/state';
  const account = new Account(stateDir);
  switch (cmd) {
    case 'reset-account':
      await account.reset();
      console.log('Compte supprimé. Redémarre le conteneur : un nouveau lien /setup sera affiché dans les logs.');
      break;
    case 'status':
      console.log(JSON.stringify({ account_configured: await account.isConfigured() }));
      break;
    default:
      console.log('Usage: node dist/cli.js <reset-account|status>');
      process.exit(cmd ? 1 : 0);
  }
}

void main();
