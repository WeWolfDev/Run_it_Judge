async function seedCasterAccount(query, env = process.env) {
	if (!env.CASTER_ACCESS_CODE) return;
	await query(
		`INSERT INTO users (username, access_code, role)
		 VALUES ($1, $2, 'caster')
		 ON CONFLICT (access_code) DO NOTHING`,
		[env.CASTER_USERNAME || 'caster', env.CASTER_ACCESS_CODE],
	);
}

module.exports = { seedCasterAccount };
