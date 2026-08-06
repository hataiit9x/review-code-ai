#!/usr/bin/env node

const { redactSensitiveText } = require('../lib/config.js');
const configuredSecrets = [
    process.env.GITLAB_ACCESS_TOKEN,
    process.env.GITLAB_TOKEN,
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_ACCESS_TOKEN,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_ACCESS_TOKEN,
    ...getLegacySecretFlagValues(process.argv),
].filter(value => typeof value === 'string' && value.length > 0)
    .flatMap(value => value.split(',').map(secret => secret.trim()))
    .filter(value => value.length > 0);

const reportFailure = error => {
    const message = error instanceof Error
        ? redactSensitiveText(error.message, configuredSecrets)
        : 'Review operation failed unexpectedly.';
    console.error(message);
    process.exit(1);
};

function getLegacySecretFlagValues(argv) {
    const values = [];
    const flags = ['--gitlab-access-token', '-t', '--openai-access-token', '-a'];

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const flag = flags.find(candidate => argument === candidate || argument.startsWith(`${candidate}=`));
        if (!flag) continue;

        if (argument.startsWith(`${flag}=`)) {
            values.push(argument.slice(flag.length + 1));
        } else if (argv[index + 1]) {
            values.push(argv[index + 1]);
        }
    }

    return values;
}

let run;
try {
    run = require('../lib/index.js');
} catch (error) {
    reportFailure(error);
}

run().catch(reportFailure);
