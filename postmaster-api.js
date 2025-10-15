const { google } = require('googleapis');
const moment = require('moment');

class PostmasterToolsClient {
    constructor(authClient) {
        this.gmailpostmastertools = google.gmailpostmastertools({
            version: 'v1',
            auth: authClient,
        });
    }

    async listVerifiedDomains() {
        const res = await this.gmailpostmastertools.domains.list();
        return res.data.domains ? res.data.domains.map(d => d.name) : [];
    }
    
    async _getDailyStats(domainName, dateObj) {
        const resourceName = `domains/${domainName}/trafficStats/${moment(dateObj).format('YYYYMMDD')}`;
        try {
            const res = await this.gmailpostmastertools.domains.trafficStats.get({ name: resourceName });
            return res.data;
        } catch (error) {
            if (error.code === 404 || error.code === 400) {
                // This is expected for days with no data
                return null;
            }
            console.error(`A non-HTTP error occurred while fetching stats for ${domainName}:`, error.message);
            return null;
        }
    }

    async findNearestAvailableStat(domainName, daysBack = 30) {
        const today = moment();
        for (let i = 2; i <= daysBack; i++) {
            const targetDate = today.clone().subtract(i, 'days').toDate();
            const stats = await this._getDailyStats(domainName, targetDate);
            if (stats) {
                stats.date = moment(targetDate).format('YYYY-MM-DD');
                return stats;
            }
        }
        return null;
    }

    _processIpReputations(ipReputationsData = []) {
        if (!ipReputationsData || ipReputationsData.length === 0) {
            return { trueIpReputation: 'NONE', ipReputationList: [] };
        }

        let trueIpReputation = 'NONE';
        const ipReputationList = ipReputationsData.map(repData => {
            const ipPrefix = (repData.sampleIps && repData.sampleIps.length > 0) ? repData.sampleIps[0] : null;
            const reputation = (repData.reputation || 'NONE').toUpperCase();
            
            if (ipPrefix && trueIpReputation === 'NONE') {
                trueIpReputation = reputation;
            }

            return { reputation, ip_prefix: ipPrefix };
        });

        return { trueIpReputation, ipReputationList };
    }

    _safeGetFraction(stats, key) {
        const value = stats[key];
        if (typeof value === 'number') {
            return parseFloat((value * 100).toFixed(2));
        }
        return 0.0;
    }

    extractMetrics(stats) {
        if (!stats) return {};

        const { trueIpReputation, ipReputationList } = this._processIpReputations(stats.ipReputations);
        
        let totalErrorRate = 0;
        if (Array.isArray(stats.deliveryErrors)) {
            totalErrorRate = stats.deliveryErrors.reduce((sum, error) => sum + (error.errorRatio || 0), 0);
        }

        return {
            date: stats.date,
            spam_rate: this._safeGetFraction(stats, 'spamRatio'),
            delivery_errors_rate: parseFloat((totalErrorRate * 100).toFixed(2)),
            user_reported_spam_rate: this._safeGetFraction(stats, 'userReportedSpamRatio'),
            overall_reputation: (stats.domainReputation || 'NONE').toUpperCase(),
            true_ip_reputation: trueIpReputation,
            ip_reputations: ipReputationList,
        };
    }

    async getHistoricalStats(domain, startDateStr, endDateStr) {
        const startDate = moment(startDateStr, 'YYYY-MM-DD');
        const endDate = moment(endDateStr, 'YYYY-MM-DD');
        
        const dateList = [];
        for (let m = startDate; m.isSameOrBefore(endDate); m.add(1, 'days')) {
            dateList.push(m.toDate());
        }

        const repMap = { 'HIGH': 4, 'MEDIUM': 3, 'LOW': 2, 'BAD': 1 };
        const chartData = {
            labels: [], userReportedSpam: [], domainReputation: [], ipReputation: [], deliveryErrors: []
        };

        for (const date of dateList) {
            chartData.labels.push(moment(date).format('YYYY-MM-DD'));
            const stats = await this._getDailyStats(domain, date);
            if (stats) {
                const metrics = this.extractMetrics(stats);
                chartData.userReportedSpam.push(metrics.user_reported_spam_rate);
                chartData.deliveryErrors.push(metrics.delivery_errors_rate);
                
                const domainRepStr = metrics.overall_reputation;
                chartData.domainReputation.push(domainRepStr === 'NONE' ? null : repMap[domainRepStr]);
                
                const ipRepStr = metrics.true_ip_reputation;
                chartData.ipReputation.push(ipRepStr === 'NONE' ? null : repMap[ipRepStr]);
            } else {
                chartData.userReportedSpam.push(null);
                chartData.domainReputation.push(null);
                chartData.ipReputation.push(null);
                chartData.deliveryErrors.push(null);
            }
        }
        return chartData;
    }

    async processSingleDomainStats(domain, startDateStr, endDateStr) {
        const startDate = moment(startDateStr, 'YYYY-MM-DD');
        const endDate = moment(endDateStr, 'YYYY-MM-DD');

        const dateList = [];
        for (let m = startDate; m.isSameOrBefore(endDate); m.add(1, 'days')) {
            dateList.push(m.toDate());
        }
        
        const domainStats = { domain: domain, daily_stats: {} };

        for (const date of dateList) {
            const stats = await this._getDailyStats(domain, date);
            if (stats) {
                stats.date = moment(date).format('YYYY-MM-DD');
                const metrics = this.extractMetrics(stats);
                domainStats.daily_stats[moment(date).format('YYYY-MM-DD')] = metrics;
            }
        }
        return domainStats;
    }
}

module.exports = { PostmasterToolsClient };
