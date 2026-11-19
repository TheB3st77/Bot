const { SlashCommandBuilder } = require('discord.js');
const { db, rankNames, ensureRankThresholds } = require('../database');
const {
  embed, requireStaff, syncRankRole, formatRank, logAction, safeDM,
} = require('../utils');

const rankChoices = rankNames.map((name, value) => ({ name, value }));

function setManualRank(interaction, user, nextRank, action) {
  const current = db.prepare('SELECT rank_index FROM member_ranks WHERE guild_id = ? AND user_id = ?')
    .get(interaction.guildId, user.id)?.rank_index ?? 0;
  if (current === nextRank) return { current, changed: false };
  db.prepare(`INSERT INTO member_ranks (guild_id, user_id, rank_index) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET rank_index = excluded.rank_index`)
    .run(interaction.guildId, user.id, nextRank);
  db.prepare('INSERT INTO rank_history (guild_id, user_id, from_rank, to_rank, reason, actor_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(interaction.guildId, user.id, current, nextRank, `Cambio manual: ${action}`, interaction.user.id);
  logAction(interaction.guildId, interaction.user.id, action, user.id, `${formatRank(current)} → ${formatRank(nextRank)}`);
  return { current, changed: true };
}

const commands = [
  {
    data: new SlashCommandBuilder().setName('rangos').setDescription('Consulta los rangos y sus requisitos de puntos'),
    async execute(interaction) {
      ensureRankThresholds(interaction.guildId);
      const thresholds = db.prepare('SELECT rank_index, points FROM rank_thresholds WHERE guild_id = ? ORDER BY rank_index').all(interaction.guildId);
      const description = thresholds.map((row) => `**${rankNames[row.rank_index]}** — ${row.points} puntos`).join('\n');
      await interaction.reply({ embeds: [embed('Rangos del Media Team', `${description}\n\nLos cambios de puntos actualizan automáticamente el rango.`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('ascender').setDescription('Asciende manualmente a un miembro')
      .addUserOption((option) => option.setName('usuario').setDescription('Miembro que será ascendido').setRequired(true))
      .addIntegerOption((option) => option.setName('rango').setDescription('Rango destino (por defecto, el siguiente)').addChoices(...rankChoices))
      .addStringOption((option) => option.setName('motivo').setDescription('Motivo del ascenso').setMaxLength(300)),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const user = interaction.options.getUser('usuario');
      const current = db.prepare('SELECT rank_index FROM member_ranks WHERE guild_id = ? AND user_id = ?')
        .get(interaction.guildId, user.id)?.rank_index ?? 0;
      const requested = interaction.options.getInteger('rango');
      const next = requested ?? Math.min(rankNames.length - 1, current + 1);
      if (next <= current) {
        await interaction.reply({ embeds: [embed('Rango no válido', 'El rango de destino debe ser superior al rango actual. Usa `/descender` para reducirlo.')], ephemeral: true });
        return;
      }
      const result = setManualRank(interaction, user, next, `ascenso: ${interaction.options.getString('motivo') || 'sin motivo indicado'}`);
      if (result.changed) await syncRankRole(interaction.guild, user.id, next);
      await safeDM(user, `Has sido ascendido a **${formatRank(next)}** en **${interaction.guild.name}**.`);
      await interaction.reply({ embeds: [embed('Ascenso registrado', `${user} ha sido ascendido de **${formatRank(current)}** a **${formatRank(next)}**.`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('descender').setDescription('Desciende manualmente a un miembro')
      .addUserOption((option) => option.setName('usuario').setDescription('Miembro que será descendido').setRequired(true))
      .addIntegerOption((option) => option.setName('rango').setDescription('Rango destino (por defecto, el anterior)').addChoices(...rankChoices))
      .addStringOption((option) => option.setName('motivo').setDescription('Motivo del descenso').setMaxLength(300)),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const user = interaction.options.getUser('usuario');
      const current = db.prepare('SELECT rank_index FROM member_ranks WHERE guild_id = ? AND user_id = ?')
        .get(interaction.guildId, user.id)?.rank_index ?? 0;
      const requested = interaction.options.getInteger('rango');
      const next = requested ?? Math.max(0, current - 1);
      if (next >= current) {
        await interaction.reply({ embeds: [embed('Rango no válido', 'El rango de destino debe ser inferior al rango actual.')], ephemeral: true });
        return;
      }
      setManualRank(interaction, user, next, `descenso: ${interaction.options.getString('motivo') || 'sin motivo indicado'}`);
      await syncRankRole(interaction.guild, user.id, next);
      await safeDM(user, `Tu rango en **${interaction.guild.name}** se actualizó a **${formatRank(next)}**.`);
      await interaction.reply({ embeds: [embed('Descenso registrado', `${user} ha pasado de **${formatRank(current)}** a **${formatRank(next)}**.`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('historial-rangos').setDescription('Consulta los cambios recientes de rango')
      .addUserOption((option) => option.setName('usuario').setDescription('Miembro (opcional)')),
    async execute(interaction) {
      const user = interaction.options.getUser('usuario');
      const rows = user
        ? db.prepare('SELECT * FROM rank_history WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 10').all(interaction.guildId, user.id)
        : db.prepare('SELECT * FROM rank_history WHERE guild_id = ? ORDER BY id DESC LIMIT 10').all(interaction.guildId);
      const description = rows.length
        ? rows.map((row) => `<t:${Math.floor(new Date(`${row.created_at} UTC`).getTime() / 1000)}:R> — <@${row.user_id}>: **${formatRank(row.from_rank)}** → **${formatRank(row.to_rank)}**\nMotivo: ${row.reason} · Staff: <@${row.actor_id}>`).join('\n\n')
        : 'No hay cambios de rango registrados.';
      await interaction.reply({ embeds: [embed('Historial de rangos', description)], ephemeral: Boolean(user) });
    },
  },
];

module.exports = { commands };
