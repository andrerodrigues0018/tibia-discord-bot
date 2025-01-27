import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from 'hono/adapter';
import { Redis } from "@upstash/redis/cloudflare";
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';


type Env = {
  Bindings: {
		DISCORD_API_KEY: string;
		UPSTASH_REDIS_REST_URL: string;
		UPSTASH_REDIS_REST_TOKEN: string;
  };
};

type BodyGuild ={
	guild: {
		members: iGuildMembers[];
	}
}

type BodyPlayer ={
	character: {
		name: string;
		deaths: Deaths[];
	}
}

type Deaths = {
	level: number;
	time: string;
	reason: string;
}

type DeathMember = {
	name: string;
	time: string;
	level: number;
	deathLevel: number;
	reason: string;
}

type iGuildMembers = {
	name: string;
	level: number;
	vocation: 'Elite Knight' | 'Master Sorcerer' | 'Royal Paladin' | 'Elder Druid' | 'Knight' | 'Sorcerer' | 'Paladin' | 'Druid';
	joined: string;
	rank_title: string;
}

type iGuildMembersSimples = {
	name: string;
	level: number;
}

const app = new Hono<Env>();
app.use(cors());

app.get("/", c => {
	return c.json({ hello: "World" });
});

app.get('/guild/:guildName/deaths', async (c) => {
	const guildName = c.req.param('guildName');
	const { DISCORD_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN} = env(c);

	const redis = new Redis({
		url: UPSTASH_REDIS_REST_URL,
		token: UPSTASH_REDIS_REST_TOKEN,
	})

	const classList = { 'Elite Knight': '🛡️', 'Master Sorcerer': '🔥' , 'Royal Paladin': '🏹' , 'Elder Druid': '🌱', 'Knight': '🛡️', 'Sorcerer': '🔥' , 'Paladin': '🏹' , 'Druid': '🌱' }; 

	const response = await fetch(`https://api.tibiadata.com/v4/guild/${guildName}`);
	const body = await response.json() as BodyGuild;
	const guildMembers  = body.guild.members;
	const redisGuildJson = await redis.get(`guild:${guildName}:members`) as iGuildMembers[] | null;
	const cachedGuildMembers:iGuildMembers[] = redisGuildJson ?? [];

	const deathMembers:DeathMember[] = [];
	const newMembers:iGuildMembers[] = [];
	const cachedMembers: iGuildMembersSimples[] = [];
	await Promise.all(guildMembers.map(async member => {
		const cachedMember = cachedGuildMembers.find(cached => cached.name === member.name);
		
		if (cachedMember) {
			cachedMembers.push({ name: member.name, level: member.level });
			if (member.level < cachedMember.level) {
				const response = await fetch(`https://api.tibiadata.com/v4/character/${encodeURIComponent(member.name)}`);
				const body = await response.json() as BodyPlayer;
				const characterData  = body.character;
				if (!characterData.deaths || characterData.deaths.length === 0) {
					return;
				}
				const death = characterData.deaths[0];
				const ISODate = new Date(new Date(death.time).getTime() - 3 * 60 * 60 * 1000).toISOString()
				const deathFormatted = {
					name: `${classList[member.vocation]} ${member.name}`,
					time: ISODate,
					level: member.level,
					deathLevel: death.level,
					reason: death.reason,
				};
				console.log(deathFormatted)
				deathMembers.push(deathFormatted);
			}
		} else {
			newMembers.push(member);
		}
	}));

	const updatedCachedGuildMembers = [
		...cachedMembers,
		...newMembers.map(member => ({ name: member.name, level: member.level }))
	];

	if (deathMembers.length > 0) {
		await sendDiscordMessageDeath(deathMembers, DISCORD_API_KEY);
	}
	
	await redis.set(`guild:${guildName}:members`, updatedCachedGuildMembers);

	return c.json({ deathMembers });
});

async function sendDiscordMessageDeath(deathMembers: DeathMember[], DISCORD_API_KEY: string) {

	const CHANNEL_ID = '1325235117136023552';
	const rest = new REST({ version: '10' }).setToken(DISCORD_API_KEY);

	const messagePromisses = deathMembers.map(async (death) => {
		try {
			await rest.post(Routes.channelMessages(CHANNEL_ID), {
				body: {
					content: `\n### 🚨🚨🚨 ATENÇÃO!! 1 minuto de silencio para: 🚨🚨🚨\n👼 Player: **${death.name}**\n🎯 Level: **${death.level}** \n🏷️ Reason: **${death.reason}** \n⏰ Time: **${death.time}**\n-# 🪦 **RIP**! Sentiremos sempre sua falta!`,
				},
			});
		} catch (error) {
			console.error(error);
		}
	});

	await Promise.all(messagePromisses);

}

export default app;
