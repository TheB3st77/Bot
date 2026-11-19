require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
  throw new Error('Configura DISCORD_TOKEN y DISCORD_CLIENT_ID en el archivo .env.');
}

const commands = [];
for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter((name) => name.endsWith('.js'))) {
  commands.push(...require(path.join(__dirname, 'commands', file)).commands.map((command) => command.data.toJSON()));
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKENMTU3MjcyNzQ5ODA1ODM3MTI0Mg.GNY7UT.XBT4yhLHjbTcql-eKnYxTAvd_bA5T-AamgVC3Q);
const route = process.env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);

rest.put(route, { body: commands })
  .then(() => console.log(`${commands.length} comandos de ESKMC MEDIA MANAGER registrados correctamente.`))
  .catch((error) => {
    console.error('No se pudieron registrar los comandos:', error);
    process.exitCode = 1;
  });
