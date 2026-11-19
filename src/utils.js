const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { db, rankNames, ensureRankThresholds, getSetting, logAction } = require('./database');

const PURPLE = 0x9333EA;

function embed(title, description) {
  return new EmbedBuilder().setColor(PURPLE).setTitle(title).setDescription(description).setTimestamp();
}

function isStaff(member) {
  const staffRoleId = getSetting(member.guild.id, 'staff_role');
  return member.permissions.has(PermissionFlagsBits.ManageGuild)
    || (staffRoleId && member.roles.cache.has(staffRoleId));
}

async function requireStaff(interaction) {
  if (isStaff(interaction.member)) return true;
  await interaction.reply({ embeds: [embed('Acceso denegado', 'Este comando está reservado al Staff autorizado.')], ephemeral: true });
  return false;
}

function configuredChannel(guild, key) {
  const id = getSetting(guild.id, key);
  return id ? guild.channels.cache.get(id) || null : null;
}

function rankForPoints(guildId, points) {
  ensureRankThresholds(guildId);
  const thresholds = db.prepare('SELECT rank_index, points FROM rank_thresholds WHERE guild_id = ? ORDER BY rank_index').all(guildId);
  return thresholds.reduce((best, row) => points >= row.points ? row.rank_index : best, 0);
}

async function syncRankRole(guild, userId, rankIndex) {
  const roleIds = JSON.parse(getSetting(guild.id, 'rank_roles') || '[]')
    .map((id) => id && guild.roles.cache.has(id) ? id : null);
  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch (error) {
    if (error.code === 10007) return;
    throw error;
  }
  if (!member) return;
  const rankRoleIds = roleIds.filter(Boolean);
  const remove = rankRoleIds.filter((id, index) => index !== rankIndex && member.roles.cache.has(id));
  if (remove.length) await member.roles.remove(remove, 'Actualización automática del rango');
  const roleId = roleRole(roleIds, rankIndex);
  if (roleId && !member.roles.cache.has(roleId)) await member.roles.add(roleId, 'Actualización automática del rango');
}

function roleRole(roleIds, index) {
  return roleIds[index] || null;
}

function updateAutomaticRank(guild, userId, actorId, reason = 'Ajuste automático por puntos') {
  ensureRankThresholds(guild.id);
  const amount = db.prepare('SELECT amount FROM points WHERE guild_id = ? AND user_id = ?').get(guild.id, userId)?.amount || 0;
  const nextRank = rankForPoints(guild.id, amount);
  const previous = db.prepare('SELECT rank_index FROM member_ranks WHERE guild_id = ? AND user_id = ?')
    .get(guild.id, userId)?.rank_index ?? 0;
  if (previous !== nextRank) {
    db.prepare(`INSERT INTO member_ranks (guild_id, user_id, rank_index) VALUES (?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET rank_index = excluded.rank_index`).run(guild.id, userId, nextRank);
    db.prepare('INSERT INTO rank_history (guild_id, user_id, from_rank, to_rank, reason, actor_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(guild.id, userId, previous, nextRank, reason, actorId);
    logAction(guild.id, actorId, 'cambio_automatico_rango', userId, `${rankNames[previous]} → ${rankNames[nextRank]}`);
    return { previous, nextRank };
  }
  return null;
}

function formatRank(index) {
  return rankNames[index] || 'Sin rango';
}

async function safeDM(user, message) {
  try {
    await user.send(message);
    return true;
  } catch (error) {
    if (error.code === 50007) return false;
    throw error;
  }
}

module.exports = {
  PURPLE, embed, isStaff, requireStaff, configuredChannel, rankForPoints,
  syncRankRole, updateAutomaticRank, formatRank, safeDM, logAction, getSetting,
};
