const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { db, ensureRankThresholds } = require('../database');
const {
  embed, requireStaff, updateAutomaticRank, syncRankRole, formatRank, logAction, safeDM,
} = require('../utils');

const userOption = (builder) => builder.addUserOption((option) => option.setName('usuario').setDescription('Miembro del servidor').setRequired(true));

const commands = [
  {
    data: new SlashCommandBuilder().setName('puntos').setDescription('Consulta tus puntos o los de otro miembro')
      .addUserOption((option) => option.setName('usuario').setDescription('Miembro que quieres consultar')),
    async execute(interaction) {
      const user = interaction.options.getUser('usuario') || interaction.user;
      const amount = db.prepare('SELECT amount FROM points WHERE guild_id = ? AND user_id = ?')
        .get(interaction.guildId, user.id)?.amount || 0;
      ensureRankThresholds(interaction.guildId);
      const rank = db.prepare('SELECT rank_index FROM member_ranks WHERE guild_id = ? AND user_id = ?')
        .get(interaction.guildId, user.id)?.rank_index ?? 0;
      await interaction.reply({ embeds: [embed(`Puntos de ${user.username}`, `**Puntos:** ${amount}\n**Rango:** ${formatRank(rank)}`)] });
    },
  },
  {
    data: userOption(new SlashCommandBuilder().setName('dar-puntos').setDescription('Añade puntos a un miembro'))
      .addIntegerOption((option) => option.setName('cantidad').setDescription('Cantidad de puntos').setMinValue(1).setRequired(true))
      .addStringOption((option) => option.setName('motivo').setDescription('Motivo de la asignación').setMaxLength(300)),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const user = interaction.options.getUser('usuario');
      const amount = interaction.options.getInteger('cantidad');
      const reason = interaction.options.getString('motivo') || 'Sin motivo indicado';
      db.prepare(`INSERT INTO points (guild_id, user_id, amount) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET amount = amount + excluded.amount`)
        .run(interaction.guildId, user.id, amount);
      const change = updateAutomaticRank(interaction.guild, user.id, interaction.user.id);
      if (change) await syncRankRole(interaction.guild, user.id, change.nextRank);
      await safeDM(user, `Se añadieron **${amount} puntos** a tu cuenta en **${interaction.guild.name}**.${change ? ` Tu nuevo rango es **${formatRank(change.nextRank)}**.` : ''}`);
      logAction(interaction.guildId, interaction.user.id, 'dar_puntos', user.id, `${amount} puntos. ${reason}`);
      await interaction.reply({ embeds: [embed('Puntos añadidos', `Se añadieron **${amount} puntos** a ${user}.\n**Nuevo total:** ${db.prepare('SELECT amount FROM points WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, user.id).amount}${change ? `\n**Nuevo rango:** ${formatRank(change.nextRank)}` : ''}`)] });
    },
  },
  {
    data: userOption(new SlashCommandBuilder().setName('quitar-puntos').setDescription('Quita puntos a un miembro'))
      .addIntegerOption((option) => option.setName('cantidad').setDescription('Cantidad de puntos').setMinValue(1).setRequired(true))
      .addStringOption((option) => option.setName('motivo').setDescription('Motivo del ajuste').setMaxLength(300)),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const user = interaction.options.getUser('usuario');
      const amount = interaction.options.getInteger('cantidad');
      const reason = interaction.options.getString('motivo') || 'Sin motivo indicado';
      db.prepare(`INSERT INTO points (guild_id, user_id, amount) VALUES (?, ?, 0)
        ON CONFLICT(guild_id, user_id) DO NOTHING`).run(interaction.guildId, user.id);
      db.prepare('UPDATE points SET amount = MAX(0, amount - ?) WHERE guild_id = ? AND user_id = ?')
        .run(amount, interaction.guildId, user.id);
      const change = updateAutomaticRank(interaction.guild, user.id, interaction.user.id);
      if (change) await syncRankRole(interaction.guild, user.id, change.nextRank);
      await safeDM(user, `Se descontaron hasta **${amount} puntos** de tu cuenta en **${interaction.guild.name}**.${change ? ` Tu nuevo rango es **${formatRank(change.nextRank)}**.` : ''}`);
      const total = db.prepare('SELECT amount FROM points WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, user.id).amount;
      logAction(interaction.guildId, interaction.user.id, 'quitar_puntos', user.id, `${amount} puntos. ${reason}`);
      await interaction.reply({ embeds: [embed('Puntos actualizados', `Se descontaron hasta **${amount} puntos** a ${user}.\n**Nuevo total:** ${total}${change ? `\n**Nuevo rango:** ${formatRank(change.nextRank)}` : ''}`)] });
    },
  },
  {
    data: userOption(new SlashCommandBuilder().setName('reiniciar-puntos').setDescription('Reinicia los puntos de un miembro')),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const user = interaction.options.getUser('usuario');
      db.prepare(`INSERT INTO points (guild_id, user_id, amount) VALUES (?, ?, 0)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET amount = 0`).run(interaction.guildId, user.id);
      const change = updateAutomaticRank(interaction.guild, user.id, interaction.user.id, 'Reinicio individual de puntos');
      if (change) await syncRankRole(interaction.guild, user.id, change.nextRank);
      await safeDM(user, `Tus puntos en **${interaction.guild.name}** se reiniciaron a **0**.${change ? ` Tu nuevo rango es **${formatRank(change.nextRank)}**.` : ''}`);
      logAction(interaction.guildId, interaction.user.id, 'reiniciar_puntos', user.id, 'Puntos individuales reiniciados');
      await interaction.reply({ embeds: [embed('Puntos reiniciados', `Los puntos de ${user} se han reiniciado a **0**.${change ? `\n**Nuevo rango:** ${formatRank(change.nextRank)}` : ''}`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('reiniciar-todos').setDescription('Reinicia todos los puntos (requiere confirmación)'),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`reset-all:${interaction.user.id}`).setLabel('Confirmar reinicio').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`reset-cancel:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({
        embeds: [embed('Confirmar reinicio global', 'Esta acción pondrá a cero los puntos de **todos los miembros** y no se puede deshacer.')],
        components: [row], ephemeral: true,
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('clasificacion').setDescription('Muestra la clasificación de puntos'),
    async execute(interaction) {
      const rows = db.prepare('SELECT user_id, amount FROM points WHERE guild_id = ? AND amount > 0 ORDER BY amount DESC, user_id LIMIT 10').all(interaction.guildId);
      const description = rows.length
        ? rows.map((row, index) => `**${index + 1}.** <@${row.user_id}> — **${row.amount}** puntos`).join('\n')
        : 'Aún no hay puntos registrados.';
      await interaction.reply({ embeds: [embed('Clasificación del Media Team', description)] });
    },
  },
];

const buttons = {
  'reset-all': async (interaction) => {
    const [, ownerId] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ embeds: [embed('Acción privada', 'Solo quien inició esta confirmación puede usarla.')], ephemeral: true });
      return;
    }
    if (!await requireStaff(interaction)) return;
    const reset = db.transaction(() => {
      db.prepare('UPDATE points SET amount = 0 WHERE guild_id = ?').run(interaction.guildId);
      const members = db.prepare('SELECT user_id, rank_index FROM member_ranks WHERE guild_id = ?').all(interaction.guildId);
      for (const member of members) {
        if (member.rank_index !== 0) {
          db.prepare('UPDATE member_ranks SET rank_index = 0 WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, member.user_id);
          db.prepare('INSERT INTO rank_history (guild_id, user_id, from_rank, to_rank, reason, actor_id) VALUES (?, ?, ?, 0, ?, ?)')
            .run(interaction.guildId, member.user_id, member.rank_index, 'Reinicio global de puntos', interaction.user.id);
        }
      }
    });
    reset();
    const members = db.prepare('SELECT user_id FROM member_ranks WHERE guild_id = ?').all(interaction.guildId);
    for (const { user_id: userId } of members) await syncRankRole(interaction.guild, userId, 0);
    logAction(interaction.guildId, interaction.user.id, 'reiniciar_todos', null, 'Se reiniciaron todos los puntos y rangos automáticos');
    await interaction.update({ embeds: [embed('Reinicio completado', 'Todos los puntos se han reiniciado a **0**.')], components: [] });
  },
  'reset-cancel': async (interaction) => {
    const [, ownerId] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ embeds: [embed('Acción privada', 'Solo quien inició esta confirmación puede usarla.')], ephemeral: true });
      return;
    }
    await interaction.update({ embeds: [embed('Acción cancelada', 'No se modificaron los puntos.')], components: [] });
  },
};

module.exports = { commands, buttons };
