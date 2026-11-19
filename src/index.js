require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials, Events } = require('discord.js');
const { embed } = require('./utils');

if (!process.env.DISCORD_TOKEN) throw new Error('Falta DISCORD_TOKEN en el archivo .env.');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});
client.commands = new Collection();
client.buttons = new Collection();
client.modals = new Collection();

for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter((name) => name.endsWith('.js'))) {
  const module = require(path.join(__dirname, 'commands', file));
  for (const command of module.commands) client.commands.set(command.data.name, command);
  if (module.buttons) for (const [prefix, handler] of Object.entries(module.buttons)) client.buttons.set(prefix, handler);
  if (module.modals) for (const [prefix, handler] of Object.entries(module.modals)) client.modals.set(prefix, handler);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`ESKMC MEDIA MANAGER conectado como ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (command) await command.execute(interaction);
      return;
    }
    if (interaction.isButton()) {
      const [prefix] = interaction.customId.split(':');
      const handler = client.buttons.get(prefix);
      if (handler) await handler(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      const [prefix] = interaction.customId.split(':');
      const handler = client.modals.get(prefix);
      if (handler) await handler(interaction);
    }
  } catch (error) {
    console.error('Error procesando interacción:', error);
    const response = { embeds: [embed('No se pudo completar la acción', 'Ocurrió un error inesperado. Inténtalo de nuevo o contacta al Staff.')], ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(console.error);
    else await interaction.reply(response).catch(console.error);
  }
});

client.login(process.env.DISCORD_TOKEN);
