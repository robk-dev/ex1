import * as async from 'async';
import { request } from './helpers';

const fs = require('fs');
const util = require('util');
const writeFile = util.promisify(fs.writeFile);

interface Visit {
    id: number;
    name: string;
    date: Date;
}

const url = process.env.url as string;

const getToken = async (): Promise<{ token: string }> => {
    try {
        const { data } = await request(url + '/login');
        return data;
    } catch (error) {
        console.error({ msg: 'error getting token', error });
        throw error;
    }
}

const getData = async (page: string | number, token: string): Promise<{ total: number, data: Visit[] }> => {
    try {
        const { data } = await request(url + `/visits?page=${page}&token=${token}`);
        return data;
    } catch (error) {
        console.error({ msg: 'error getting data', error });
        throw error;
    }
}

const filter = (visits: Visit[]) => {
    const filtered_days = visits.filter(visit => {
        const visit_date = new Date(visit.date);
        const dayOfWeek = visit_date.getDay(); // 6 for Saturday, 0 for Sunday

        // "2020-09-16" === "2020-09-16"
        try {
            const isToday = new Date().toISOString().split('T')[0] === new Date(visit_date).toISOString().split('T')[0];

            return dayOfWeek !== 6 && dayOfWeek !== 0 && !isToday;
        } catch (error) {
            console.error({ msg: 'error filtering', visit, error });
            return error;
        }
    });

    const removed_duplicates = filtered_days.filter((visit, idx, arr) => arr.findIndex(t => (t.id === visit.id)) === idx);
    return removed_duplicates;
}

const countVisits = (visits: Visit[]) => {
    const visitors: any = {};
    visits.forEach(visit => {
        if (!visitors[visit.name]) {
            visitors[visit.name] = 1;
        } else {
            visitors[visit.name] += 1;
        }
    });

    const visit_count = Object.keys(visitors).map(name => {
        return {
            name,
            visits: visitors[name]
        };
    });

    return visit_count.sort(function (a, b) {
        if (a.name < b.name) {
            return -1;
        }
        if (a.name > b.name) {
            return 1;
        }
        return 0;
    });
}

// queue sends all requests synchronously up to parallelism limit and can add more tasks when total increases
const queue = (token: string, parallelism = 5): Promise<Visit[]> => {
    let data: any[] = [];
    let total = 0;
    let resources_per_page: number; // 15 - just an observation, not from requirements
    let pages: number = 0;

    const q = async.queue(async ({ page }, next) => {
        const { total: new_total, data: batch } = await getData(page, token);

        if (page === 1) { // initialize with first page
            resources_per_page = batch.length;
            pages = (Math.ceil(total / resources_per_page) | 0) || 1;
        }

        // left log to show parallel requests and growing list; len = 0 while it's sending all requests and hasn't added any data yet
        console.log({ page, pages, total, len: data.length });
        data = data.concat(batch); // so we dont have to reduce array of arrays later

        if (new_total > total && data.length < new_total) {
            total = new_total;
            const new_pages = Math.ceil(total / resources_per_page);

            if (new_pages > pages) {
                for (let j = pages + 1; j <= new_pages; j++) {
                    q.push({ page: j });
                }
                pages = new_pages;
            }
        }
        next();
    }, parallelism);

    return new Promise(resolve => {
        q.drain(() => {
            console.log({ total, length: data.length });
            return resolve(data);
        });

        q.push({ page: 1 });
    });
}

(async () => {
    const { token } = await getToken();
    const data = await queue(token);

    await writeFile('./data/data.json', JSON.stringify({ total: data.length, data }));

    const filtered = filter(data);
    await writeFile('./data/filtered-data.json', JSON.stringify({ total: filtered.length, data: filtered }));

    const visits_count = countVisits(filtered)
    await writeFile('./data/visits.json', JSON.stringify({ total: visits_count.length, data: visits_count }));

    return 'success';
})().then(console.log).catch(console.error);