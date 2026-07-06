import request from 'supertest';
import { app } from '../src/index.js';

describe('Health Check API', () => {
    it('GET /api/health should return 200 and all services connected', async () => {
        const response = await request(app).get('/api/health');
        console.log(response.body);
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('healthy', true);
        expect(response.body.services).toHaveProperty('postgresql', 'Connected');
        expect(response.body.services).toHaveProperty('mongodb', 'Connected');
        expect(response.body.services).toHaveProperty('rabbitmq', 'Connected');
    });
});
