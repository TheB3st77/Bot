const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { db } = require('../database');
const { embed, requireStaff, logAction } = require('../utils');

const categories = [
  { name: 'Bienvenida', value: 'bienvenida' },
  { name: 'Anuncios', value: 'anuncios' },
  { name: 'Sorteos', value: 'sorteos' },
  { name: 'Metas', value: 'metas' },
  { name: 'Media of the Week', value: 'media_week' },
  { name: 'Media del Mes', value: 'media_mes' },
  { name: 'Renovaciones', value: 'renovaciones' },
  { name: 'Ascensos', value: 'ascensos' },
  { name: 'Descensos', value: 'descensos' },
];

function findTemplate(guildId, name) {
  return db.prepare('SELECT * FROM templates WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(guildId, name);
}

const commands = [
  {
    data: new SlashCommandBuilder().setName('crear-plantilla').setDescription('Guarda una plantilla de mensaje')
      .addStringOption((option) => option.setName('nombre').setDescription('Nombre único de la plantilla').setMaxLength(80).setRequired(true))
      .addStringOption((option) => option.setName('categoria').setDescription('Tipo de plantilla').addChoices(...categories).setRequired(true))
      .addStringOption((option) => option.setName('contenido').setDescription('Texto del embed (puedes usar Markdown)').setMaxLength(4000).setRequired(true)),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const name = interaction.options.getString('nombre').trim();
      if (findTemplate(interaction.guildId, name)) {
        await interaction.reply({ embeds: [embed('Nombre en uso', 'Ya existe una plantilla con ese nombre. Usa `/editar-plantilla` para modificarla.')], ephemeral: true });
        return;
      }
      db.prepare('INSERT INTO templates (guild_id, name, category, content, updated_by) VALUES (?, ?, ?, ?, ?)')
        .run(interaction.guildId, name, interaction.options.getString('categoria'), interaction.options.getString('contenido'), interaction.user.id);
      logAction(interaction.guildId, interaction.user.id, 'crear_plantilla', null, name);
      await interaction.reply({ embeds: [embed('Plantilla creada', `La plantilla **${name}** quedó guardada.`)], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('plantillas').setDescription('Lista las plantillas guardadas'),
    async execute(interaction) {
      const rows = db.prepare('SELECT name, category, updated_at FROM templates WHERE guild_id = ? ORDER BY name COLLATE NOCASE').all(interaction.guildId);
      const description = rows.length
        ? rows.map((row) => `**${row.name}** · ${categories.find((category) => category.value === row.category)?.name || row.category}`).join('\n')
        : 'Todavía no hay plantillas guardadas.';
      await interaction.reply({ embeds: [embed('Plantillas guardadas', description)], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('editar-plantilla').setDescription('Edita una plantilla existente')
      .addStringOption((option) => option.setName('nombre').setDescription('Nombre exacto de la plantilla').setMaxLength(80).setRequired(true))
      .addStringOption((option) => option.setName('contenido').setDescription('Nuevo contenido').setMaxLength(4000).setRequired(true))
      .addStringOption((option) => option.setName('categoria').setDescription('Nueva categoría').addChoices(...categories)),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const name = interaction.options.getString('nombre');
      if (!findTemplate(interaction.guildId, name)) {
        await interaction.reply({ embeds: [embed('Plantilla no encontrada', 'Comprueba el nombre con `/plantillas`.')], ephemeral: true });
        return;
      }
      const category = interaction.options.getString('categoria');
      db.prepare(`UPDATE templates SET content = ?, category = COALESCE(?, category),
        updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND name = ? COLLATE NOCASE`)
        .run(interaction.options.getString('contenido'), category, interaction.user.id, interaction.guildId, name);
      logAction(interaction.guildId, interaction.user.id, 'editar_plantilla', null, name);
      await interaction.reply({ embeds: [embed('Plantilla actualizada', `Se actualizó **${name}**.`)], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('eliminar-plantilla').setDescription('Elimina una plantilla guardada')
      .addStringOption((option) => option.setName('nombre').setDescription('Nombre exacto de la plantilla').setMaxLength(80).setRequired(true)),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const name = interaction.options.getString('nombre');
      const result = db.prepare('DELETE FROM templates WHERE guild_id = ? AND name = ? COLLATE NOCASE').run(interaction.guildId, name);
      if (!result.changes) {
        await interaction.reply({ embeds: [embed('Plantilla no encontrada', 'No se eliminó ningún registro.')], ephemeral: true });
        return;
      }
      logAction(interaction.guildId, interaction.user.id, 'eliminar_plantilla', null, name);
      await interaction.reply({ embeds: [embed('Plantilla eliminada', `Se eliminó **${name}**.`)], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('publicar-plantilla').setDescription('Publica una plantilla en un canal')
      .addStringOption((option) => option.setName('nombre').setDescription('Nombre exacto de la plantilla').setMaxLength(80).setRequired(true))
      .addChannelOption((option) => option.setName('canal').setDescription('Canal de destino').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const name = interaction.options.getString('nombre');
      const template = findTemplate(interaction.guildId, name);
      if (!template) {
        await interaction.reply({ embeds: [embed('Plantilla no encontrada', 'Comprueba el nombre con `/plantillas`.')], ephemeral: true });
        return;
      }
      const channel = interaction.options.getChannel('canal');
      await channel.send({ embeds: [embed(template.name, template.content)], allowedMentions: { parse: [] } });
      logAction(interaction.guildId, interaction.user.id, 'publicar_plantilla', null, `${name} en #${channel.name}`);
      await interaction.reply({ embeds: [embed('Plantilla publicada', `**${name}** se publicó en ${channel}.`)], ephemeral: true });
    },
  },
];

module.exports = { commands };
