const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../database');
const { embed, requireStaff, logAction, getSetting } = require('../utils');

const rewardsCommand = new SlashCommandBuilder().setName('recompensas').setDescription('Consulta o administra el catálogo de recompensas')
  .addSubcommand((subcommand) => subcommand.setName('listar').setDescription('Muestra las recompensas disponibles'))
  .addSubcommand((subcommand) => subcommand.setName('crear').setDescription('Añade una recompensa al catálogo')
    .addStringOption((option) => option.setName('nombre').setDescription('Nombre de la recompensa').setMaxLength(80).setRequired(true))
    .addIntegerOption((option) => option.setName('costo').setDescription('Puntos necesarios para canjearla').setMinValue(1).setRequired(true))
    .addStringOption((option) => option.setName('descripcion').setDescription('Descripción de la recompensa').setMaxLength(500).setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName('eliminar').setDescription('Retira una recompensa del catálogo')
    .addIntegerOption((option) => option.setName('id').setDescription('ID de la recompensa').setMinValue(1).setRequired(true)));

const commands = [
  {
    data: rewardsCommand,
    async execute(interaction) {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'listar') {
        const rewards = db.prepare('SELECT id, name, description, cost FROM rewards WHERE guild_id = ? AND active = 1 ORDER BY cost, name')
          .all(interaction.guildId);
        const description = rewards.length
          ? rewards.map((reward) => `**#${reward.id} · ${reward.name}** — ${reward.cost} puntos\n${reward.description}`).join('\n\n')
          : 'No hay recompensas disponibles en este momento.';
        await interaction.reply({ embeds: [embed('Catálogo de recompensas', `${description}\n\nUsa \`/canjear id:<número>\` para solicitar una recompensa.`)] });
        return;
      }
      if (!await requireStaff(interaction)) return;
      if (subcommand === 'crear') {
        const name = interaction.options.getString('nombre').trim();
        const result = db.prepare('INSERT INTO rewards (guild_id, name, description, cost) VALUES (?, ?, ?, ?)')
          .run(interaction.guildId, name, interaction.options.getString('descripcion'), interaction.options.getInteger('costo'));
        logAction(interaction.guildId, interaction.user.id, 'crear_recompensa', null, `#${result.lastInsertRowid} ${name}`);
        await interaction.reply({ embeds: [embed('Recompensa añadida', `**${name}** quedó en el catálogo con el ID **${result.lastInsertRowid}**.`)], ephemeral: true });
        return;
      }
      const id = interaction.options.getInteger('id');
      const result = db.prepare('UPDATE rewards SET active = 0 WHERE guild_id = ? AND id = ? AND active = 1').run(interaction.guildId, id);
      if (!result.changes) {
        await interaction.reply({ embeds: [embed('Recompensa no encontrada', 'No hay una recompensa activa con ese ID.')], ephemeral: true });
        return;
      }
      logAction(interaction.guildId, interaction.user.id, 'eliminar_recompensa', null, `#${id}`);
      await interaction.reply({ embeds: [embed('Recompensa retirada', `La recompensa **#${id}** ya no se puede canjear.`)], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('canjear').setDescription('Canjea puntos por una recompensa')
      .addIntegerOption((option) => option.setName('id').setDescription('ID mostrado en /recompensas listar').setMinValue(1).setRequired(true)),
    async execute(interaction) {
      const rewardId = interaction.options.getInteger('id');
      const redemptionChannelId = getSetting(interaction.guildId, 'rewards_channel');
      const channel = redemptionChannelId ? interaction.guild.channels.cache.get(redemptionChannelId) : null;
      if (!channel) {
        await interaction.reply({ embeds: [embed('Canjes sin configurar', 'El Staff debe configurar un canal de notificaciones con `/configurar canales` antes de canjear recompensas.')], ephemeral: true });
        return;
      }
      const transaction = db.transaction(() => {
        const reward = db.prepare('SELECT * FROM rewards WHERE guild_id = ? AND id = ? AND active = 1').get(interaction.guildId, rewardId);
        if (!reward) return { error: 'No existe una recompensa activa con ese ID.' };
        const balance = db.prepare('SELECT amount FROM points WHERE guild_id = ? AND user_id = ?')
          .get(interaction.guildId, interaction.user.id)?.amount || 0;
        if (balance < reward.cost) return { error: `Necesitas **${reward.cost} puntos** y tienes **${balance}**.` };
        db.prepare('UPDATE points SET amount = amount - ? WHERE guild_id = ? AND user_id = ?')
          .run(reward.cost, interaction.guildId, interaction.user.id);
        db.prepare('INSERT INTO redemptions (guild_id, user_id, reward_id, cost) VALUES (?, ?, ?, ?)')
          .run(interaction.guildId, interaction.user.id, reward.id, reward.cost);
        logAction(interaction.guildId, interaction.user.id, 'canjear_recompensa', null, `#${reward.id} ${reward.name} (${reward.cost} puntos)`);
        return { reward, balance: balance - reward.cost };
      });
      const result = transaction();
      if (result.error) {
        await interaction.reply({ embeds: [embed('No se pudo canjear', result.error)], ephemeral: true });
        return;
      }
      try {
        await channel.send({ embeds: [embed('Canje solicitado', `${interaction.user} solicitó **${result.reward.name}** (ID ${result.reward.id}).`)], allowedMentions: { users: [interaction.user.id] } });
      } catch (error) {
        console.error('No se pudo notificar un canje al Staff:', error);
        await interaction.reply({ embeds: [embed('Canje registrado con aviso pendiente', `Se descontaron los puntos de **${result.reward.name}**, pero no se pudo avisar al Staff. Contacta al equipo para completar la entrega.`)], ephemeral: true });
        return;
      }
      await interaction.reply({ embeds: [embed('Canje registrado', `Solicitaste **${result.reward.name}**.\n**Costo:** ${result.reward.cost} puntos\n**Saldo restante:** ${result.balance}`)], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('historial-acciones').setDescription('Consulta el historial de acciones del bot')
      .addUserOption((option) => option.setName('usuario').setDescription('Filtra por miembro')),
    async execute(interaction) {
      if (!await requireStaff(interaction)) return;
      const user = interaction.options.getUser('usuario');
      const rows = user
        ? db.prepare('SELECT * FROM audit_log WHERE guild_id = ? AND (actor_id = ? OR target_id = ?) ORDER BY id DESC LIMIT 15').all(interaction.guildId, user.id, user.id)
        : db.prepare('SELECT * FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT 15').all(interaction.guildId);
      const description = rows.length
        ? rows.map((row) => `<t:${Math.floor(new Date(`${row.created_at} UTC`).getTime() / 1000)}:R> · **${row.action}** · Staff: <@${row.actor_id}>${row.target_id ? ` · Miembro: <@${row.target_id}>` : ''}\n${row.details}`).join('\n\n')
        : 'No hay acciones registradas.';
      await interaction.reply({ embeds: [embed('Historial de acciones', description)], ephemeral: true });
    },
  },
];

module.exports = { commands };
