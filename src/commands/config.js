const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { db, rankNames, ensureRankThresholds, setSetting, logAction } = require('../database');
const { embed, updateAutomaticRank, syncRankRole } = require('../utils');

const configCommand = new SlashCommandBuilder().setName('configurar').setDescription('Configura canales, roles y umbrales del bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) => subcommand.setName('canales').setDescription('Configura los canales de los sistemas')
    .addChannelOption((option) => option.setName('head_chat').setDescription('Canal para revisar verificaciones').addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('evidencias').setDescription('Canal de publicación de evidencias').addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('postulaciones').setDescription('Canal para revisar postulaciones').addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('recompensas').setDescription('Canal para notificar los canjes').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((subcommand) => subcommand.setName('roles').setDescription('Configura el rol de Staff, verificados y rangos')
    .addRoleOption((option) => option.setName('staff').setDescription('Rol autorizado para comandos de Staff'))
    .addRoleOption((option) => option.setName('verificado').setDescription('Rol asignado al aprobar una verificación'))
    .addRoleOption((option) => option.setName('mini_media').setDescription('Rol Mini Media'))
    .addRoleOption((option) => option.setName('media').setDescription('Rol Media'))
    .addRoleOption((option) => option.setName('media_plus').setDescription('Rol Media +'))
    .addRoleOption((option) => option.setName('famoso').setDescription('Rol Famoso'))
    .addRoleOption((option) => option.setName('partner').setDescription('Rol Partner'))
    .addRoleOption((option) => option.setName('owner_media').setDescription('Rol Owner Media')))
  .addSubcommand((subcommand) => subcommand.setName('umbrales').setDescription('Establece los puntos necesarios para cada rango')
    .addIntegerOption((option) => option.setName('mini_media').setDescription('Puntos necesarios para Mini Media').setMinValue(0).setRequired(true))
    .addIntegerOption((option) => option.setName('media').setDescription('Puntos necesarios para Media').setMinValue(0).setRequired(true))
    .addIntegerOption((option) => option.setName('media_plus').setDescription('Puntos necesarios para Media +').setMinValue(0).setRequired(true))
    .addIntegerOption((option) => option.setName('famoso').setDescription('Puntos necesarios para Famoso').setMinValue(0).setRequired(true))
    .addIntegerOption((option) => option.setName('partner').setDescription('Puntos necesarios para Partner').setMinValue(0).setRequired(true))
    .addIntegerOption((option) => option.setName('owner_media').setDescription('Puntos necesarios para Owner Media').setMinValue(0).setRequired(true)));

const optionNames = ['mini_media', 'media', 'media_plus', 'famoso', 'partner', 'owner_media'];
const commands = [{
  data: configCommand,
  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ embeds: [embed('Acceso denegado', 'Se requiere el permiso **Gestionar servidor** para configurar el bot.')], ephemeral: true });
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'canales') {
      const options = [
        ['head_chat', 'head_chat'], ['evidencias', 'evidencias'],
        ['postulaciones', 'applications_channel'], ['recompensas', 'rewards_channel'],
      ];
      let updated = 0;
      for (const [option, key] of options) {
        const channel = interaction.options.getChannel(option);
        if (channel) {
          setSetting(interaction.guildId, key, channel.id);
          updated += 1;
        }
      }
      if (!updated) {
        await interaction.reply({ embeds: [embed('Sin cambios', 'Selecciona al menos un canal para guardar.')], ephemeral: true });
        return;
      }
      logAction(interaction.guildId, interaction.user.id, 'configurar_canales', null, `${updated} canal(es) actualizados`);
      await interaction.reply({ embeds: [embed('Canales configurados', 'Se actualizaron los canales seleccionados.')], ephemeral: true });
      return;
    }
    if (subcommand === 'roles') {
      const values = [
        ['staff', 'staff_role'], ['verificado', 'verified_role'],
        ...optionNames.map((name) => [name, 'rank_roles']),
      ];
      const botHighest = interaction.guild.members.me.roles.highest.position;
      for (const [option, key] of values) {
        const role = interaction.options.getRole(option);
        if (role && key !== 'staff_role' && (role.managed || role.position >= botHighest)) {
          await interaction.reply({ embeds: [embed('Jerarquía de roles no válida', `Mueve el rol ${role} por debajo del rol más alto del bot. Los roles administrados por integraciones no se pueden asignar.`)], ephemeral: true });
          return;
        }
      }
      let roleIds = JSON.parse(require('../database').getSetting(interaction.guildId, 'rank_roles') || '[]');
      let updated = 0;
      for (const [option, key] of values) {
        const role = interaction.options.getRole(option);
        if (!role) continue;
        if (key === 'rank_roles') roleIds[optionNames.indexOf(option)] = role.id;
        else setSetting(interaction.guildId, key, role.id);
        updated += 1;
      }
      if (!updated) {
        await interaction.reply({ embeds: [embed('Sin cambios', 'Selecciona al menos un rol para guardar.')], ephemeral: true });
        return;
      }
      setSetting(interaction.guildId, 'rank_roles', JSON.stringify(roleIds));
      logAction(interaction.guildId, interaction.user.id, 'configurar_roles', null, `${updated} rol(es) actualizados`);
      await interaction.reply({ embeds: [embed('Roles configurados', 'Se actualizaron los roles seleccionados.')], ephemeral: true });
      return;
    }
    ensureRankThresholds(interaction.guildId);
    const thresholds = optionNames.map((name) => interaction.options.getInteger(name));
    if (thresholds[0] !== 0 || thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1])) {
      await interaction.reply({ embeds: [embed('Umbrales no válidos', 'Mini Media debe comenzar en **0** y cada rango posterior debe exigir más puntos que el anterior.')], ephemeral: true });
      return;
    }
    const update = db.prepare('UPDATE rank_thresholds SET points = ? WHERE guild_id = ? AND rank_index = ?');
    const save = db.transaction(() => thresholds.forEach((value, index) => update.run(value, interaction.guildId, index)));
    save();
    const members = db.prepare('SELECT user_id FROM points WHERE guild_id = ?').all(interaction.guildId);
    for (const { user_id: userId } of members) {
      const change = updateAutomaticRank(interaction.guild, userId, interaction.user.id, 'Ajuste por cambios en los umbrales');
      if (change) await syncRankRole(interaction.guild, userId, change.nextRank);
    }
    logAction(interaction.guildId, interaction.user.id, 'configurar_umbrales', null, thresholds.join(', '));
    await interaction.reply({ embeds: [embed('Umbrales actualizados', rankNames.map((name, index) => `**${name}:** ${thresholds[index]} puntos`).join('\n'))], ephemeral: true });
  },
}];

module.exports = { commands };
