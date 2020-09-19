const axios = require('axios');
const https = require('https');

const instance = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true }) // keepAlive & pool for reusing tcp connection/sockets
});

const getExponentialRetryTime = (attempt: number, max_wait_time_ms: number) => {
    return Math.min(Math.pow(2, attempt) + Math.floor(Math.random() * 1000), max_wait_time_ms);
};

const wait = (wait_time_ms: number) => {
    return new Promise(resolve => setTimeout(() => resolve(), wait_time_ms));
}

const max_wait_time = 20000; // 20s

export const request = async (url: string) => {
    let attempt = 1;
    let response = null;
    const MAX_RETRIES = 4;

    while (attempt < MAX_RETRIES && !response) {
        if (attempt > 1) {
            const wait_time = getExponentialRetryTime(attempt, max_wait_time);
            await wait(wait_time);
        }

        try {
            response = await instance.get(url);
            return response;
        } catch (error) {
            console.error({ msg: 'error sending http request', error });
        }
        attempt++;
    }
    throw new Error(`Failed to get data after ${attempt - 1} attempts`);
}

// not in use; cant adjust for dynamic pages/number of entries being added
export const get_in_parallel = async (token: string, getData: Function) => {
    let data: any[] = [];
    let { total } = await getData(0, token);
    const resources_per_page = 15; // just an observation, not from requirements

    const pages = Math.ceil(total / resources_per_page) || 1;

    await Promise.all(new Array(pages).fill(undefined)
        .map(async (_val, i) => {
            const { data: batch } = await getData(i + 1, token);

            data = data.concat(batch); // so we dont have to reduce array of arrays later
            return i;
        }));
    return data;
}