const AgentAnalytics = require('../models/AgentAnalytics');
const Application = require('../models/Application');
const User = require('../models/User');
const Job = require('../models/Job');

// Get agent dashboard analytics
const getAgentDashboardAnalytics = async (req, res) => {
  try {
    const agentId = req.user._id;
    
    // Verify user is an agent
    if (req.user.userType !== 'agent') {
      return res.status(403).json({
        success: false,
        message: 'Only agents can access analytics'
      });
    }

    // Get agent data
    const agent = await User.findById(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }
    
    // Calculate current metrics
    const currentMetrics = await calculateCurrentMetrics(agentId, agent);
    
    // Get monthly trends (last 6 months)
    const monthlyTrends = await getMonthlyTrends(agentId, 6);
    
    // Get performance comparison
    const performanceComparison = await getPerformanceComparison(agentId);
    
    // Get job category breakdown
    const jobCategoryBreakdown = await getJobCategoryBreakdown(agentId);

    // Update daily analytics record
    await AgentAnalytics.updateDailyAnalytics(agentId, {
      candidateMetrics: currentMetrics.candidateMetrics,
      applicationMetrics: currentMetrics.applicationMetrics,
      performanceMetrics: currentMetrics.performanceMetrics,
      jobCategories: jobCategoryBreakdown,
    });

    res.json({
      success: true,
      data: {
        currentMetrics,
        monthlyTrends,
        performanceComparison,
        jobCategoryBreakdown,
        lastUpdated: new Date(),
      }
    });

  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching analytics data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get detailed analytics for a specific period
const getDetailedAnalytics = async (req, res) => {
  try {
    const agentId = req.user._id;
    const { startDate, endDate, period = 'daily' } = req.query;

    // Verify user is an agent
    if (req.user.userType !== 'agent') {
      return res.status(403).json({
        success: false,
        message: 'Only agents can access analytics'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get analytics data for the period
    const analyticsData = await AgentAnalytics.getAnalyticsRange(agentId, start, end);
    
    // Aggregate data based on period
    const aggregatedData = aggregateAnalyticsData(analyticsData, period);

    res.json({
      success: true,
      data: {
        period,
        startDate: start,
        endDate: end,
        analytics: aggregatedData,
      }
    });

  } catch (error) {
    console.error('Detailed analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching detailed analytics'
    });
  }
};

// Update analytics (called by system or manually)
const updateAnalytics = async (req, res) => {
  try {
    const agentId = req.user._id;
    
    // Verify user is an agent
    if (req.user.userType !== 'agent') {
      return res.status(403).json({
        success: false,
        message: 'Only agents can update analytics'
      });
    }

    const agent = await User.findById(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    const metrics = await calculateCurrentMetrics(agentId, agent);
    const jobCategories = await getJobCategoryBreakdown(agentId);
    
    // Update daily analytics
    const updatedAnalytics = await AgentAnalytics.updateDailyAnalytics(agentId, {
      candidateMetrics: metrics.candidateMetrics,
      applicationMetrics: metrics.applicationMetrics,
      performanceMetrics: metrics.performanceMetrics,
      jobCategories: jobCategories,
    });

    res.json({
      success: true,
      message: 'Analytics updated successfully',
      data: updatedAnalytics,
    });

  } catch (error) {
    console.error('Update analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating analytics'
    });
  }
};

// Helper Functions

const calculateCurrentMetrics = async (agentId, agent) => {
  try {
    // Initialize default values
    const defaultMetrics = {
      candidateMetrics: {
        totalManaged: 0,
        newCandidates: 0,
        activeCandidates: 0,
        inactiveCandidates: 0,
        successfulPlacements: 0,
      },
      applicationMetrics: {
        totalApplications: 0,
        pendingApplications: 0,
        approvedApplications: 0,
        rejectedApplications: 0,
        interviewScheduled: 0,
      },
      performanceMetrics: {
        placementSuccessRate: 0,
        averageTimeToPlacement: 0,
        responseRate: 85,
        clientSatisfactionScore: 4.2,
      },
    };

    // Check if agent has managedCandidates array
    if (!agent.managedCandidates || !Array.isArray(agent.managedCandidates)) {
      return defaultMetrics;
    }

    // Candidate Metrics
    const totalManagedCandidates = agent.managedCandidates.length;
    
    // Get current month start
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const newCandidatesThisMonth = agent.managedCandidates.filter(candidate => {
      const addedDate = candidate.addedAt ? new Date(candidate.addedAt) : new Date();
      return addedDate >= currentMonth;
    }).length;

    const agentApplications = await Application.find({ agent: agentId })
      .select('status appliedAt updatedAt candidateId')
      .lean();

    let totalApplications = 0;
    let pendingApplications = 0;
    let approvedApplications = 0;
    let rejectedApplications = 0;
    let interviewScheduled = 0;
    let respondedApplications = 0;
    let totalPlacementDays = 0;

    agentApplications.forEach((application) => {
      totalApplications++;

      const normalizedStatus = String(application.status || 'Pending').toLowerCase();
      if (application.updatedAt && application.appliedAt && new Date(application.updatedAt) > new Date(application.appliedAt)) {
        respondedApplications++;
      }

      switch (normalizedStatus) {
        case 'accepted':
        case 'approved':
        case 'hired':
          approvedApplications++;
          if (application.updatedAt && application.appliedAt) {
            totalPlacementDays += Math.max(
              0,
              (new Date(application.updatedAt).getTime() - new Date(application.appliedAt).getTime()) / (1000 * 60 * 60 * 24)
            );
          }
          break;
        case 'rejected':
        case 'declined':
          rejectedApplications++;
          break;
        case 'interview':
        case 'interview scheduled':
          interviewScheduled++;
          pendingApplications++;
          break;
        case 'in review':
        case 'under review':
        case 'reviewing':
        case 'pending':
        default:
          pendingApplications++;
          break;
      }
    });

    // Calculate performance metrics
    const placementSuccessRate = totalApplications > 0 
      ? (approvedApplications / totalApplications) * 100 
      : 0;
    const averageTimeToPlacement = approvedApplications > 0 ? totalPlacementDays / approvedApplications : 0;
    const responseRate = totalApplications > 0 ? (respondedApplications / totalApplications) * 100 : 0;
    const inactiveCandidates = agent.managedCandidates.filter(candidate =>
      ['Rejected', 'Inactive'].includes(String(candidate.status || ''))
    ).length;

    return {
      candidateMetrics: {
        totalManaged: totalManagedCandidates,
        newCandidates: newCandidatesThisMonth,
        activeCandidates: Math.max(totalManagedCandidates - inactiveCandidates, 0),
        inactiveCandidates,
        successfulPlacements: approvedApplications,
      },
      applicationMetrics: {
        totalApplications,
        pendingApplications,
        approvedApplications,
        rejectedApplications,
        interviewScheduled,
      },
      performanceMetrics: {
        placementSuccessRate: Math.round(placementSuccessRate * 100) / 100,
        averageTimeToPlacement: Math.round(averageTimeToPlacement * 10) / 10,
        responseRate: Math.round(responseRate * 10) / 10,
        clientSatisfactionScore: 0,
      },
    };

  } catch (error) {
    console.error('Error calculating metrics:', error);
    // Return default metrics on error
    return {
      candidateMetrics: {
        totalManaged: 0,
        newCandidates: 0,
        activeCandidates: 0,
        inactiveCandidates: 0,
        successfulPlacements: 0,
      },
      applicationMetrics: {
        totalApplications: 0,
        pendingApplications: 0,
        approvedApplications: 0,
        rejectedApplications: 0,
        interviewScheduled: 0,
      },
      performanceMetrics: {
        placementSuccessRate: 0,
        averageTimeToPlacement: 0,
        responseRate: 0,
        clientSatisfactionScore: 0,
      },
    };
  }
};

const getMonthlyTrends = async (agentId, months) => {
  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - (months - 1), 1);
    const nextMonthStart = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 1);

    const [agent, applicationRows] = await Promise.all([
      User.findById(agentId).select('managedCandidates.addedAt').lean(),
      Application.find({
        agent: agentId,
        appliedAt: { $gte: startDate, $lt: nextMonthStart },
      })
        .select('status appliedAt')
        .lean(),
    ]);

    const monthlyMap = new Map();
    for (let i = 0; i < months; i++) {
      const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(key, {
        month: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
        applications: 0,
        placements: 0,
        candidates: 0,
      });
    }

    applicationRows.forEach((application) => {
      const appliedAt = new Date(application.appliedAt);
      if (Number.isNaN(appliedAt.getTime())) return;
      const key = `${appliedAt.getFullYear()}-${String(appliedAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = monthlyMap.get(key);
      if (!bucket) return;
      bucket.applications += 1;
      if (['Accepted', 'Approved', 'Hired'].includes(String(application.status || ''))) {
        bucket.placements += 1;
      }
    });

    (agent?.managedCandidates || []).forEach((candidate) => {
      const addedAt = new Date(candidate.addedAt);
      if (Number.isNaN(addedAt.getTime()) || addedAt < startDate || addedAt >= nextMonthStart) return;
      const key = `${addedAt.getFullYear()}-${String(addedAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = monthlyMap.get(key);
      if (bucket) {
        bucket.candidates += 1;
      }
    });

    return Array.from(monthlyMap.values());
    
  } catch (error) {
    console.error('Error getting monthly trends:', error);
    return [];
  }
};

const getPerformanceComparison = async (agentId) => {
  try {
    const today = new Date();
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

    const [agent, applicationRows] = await Promise.all([
      User.findById(agentId).select('managedCandidates.addedAt').lean(),
      Application.find({
        agent: agentId,
        appliedAt: { $gte: lastMonth, $lte: today },
      })
        .select('status appliedAt')
        .lean(),
    ]);

    const buildTotals = () => ({ applications: 0, placements: 0, candidates: 0 });
    const thisMonthTotals = buildTotals();
    const lastMonthTotals = buildTotals();

    applicationRows.forEach((application) => {
      const appliedAt = new Date(application.appliedAt);
      const bucket = appliedAt >= thisMonth ? thisMonthTotals : (appliedAt >= lastMonth && appliedAt <= lastMonthEnd ? lastMonthTotals : null);
      if (!bucket) return;
      bucket.applications += 1;
      if (['Accepted', 'Approved', 'Hired'].includes(String(application.status || ''))) {
        bucket.placements += 1;
      }
    });

    (agent?.managedCandidates || []).forEach((candidate) => {
      const addedAt = new Date(candidate.addedAt);
      if (Number.isNaN(addedAt.getTime())) return;
      if (addedAt >= thisMonth) {
        thisMonthTotals.candidates += 1;
      } else if (addedAt >= lastMonth && addedAt <= lastMonthEnd) {
        lastMonthTotals.candidates += 1;
      }
    });

    return {
      thisMonth: thisMonthTotals,
      lastMonth: lastMonthTotals,
      growth: {
        applications: calculateGrowthPercentage(lastMonthTotals.applications, thisMonthTotals.applications),
        placements: calculateGrowthPercentage(lastMonthTotals.placements, thisMonthTotals.placements),
        candidates: calculateGrowthPercentage(lastMonthTotals.candidates, thisMonthTotals.candidates),
      }
    };

  } catch (error) {
    console.error('Error getting performance comparison:', error);
    return {
      thisMonth: { applications: 0, placements: 0, candidates: 0 },
      lastMonth: { applications: 0, placements: 0, candidates: 0 },
      growth: { applications: 0, placements: 0, candidates: 0 }
    };
  }
};

const getJobCategoryBreakdown = async (agentId) => {
  try {
    const applicationRows = await Application.find({ agent: agentId })
      .populate('job', 'jobCategory title')
      .select('status job')
      .lean();

    const categoryStats = new Map();

    applicationRows.forEach((application) => {
      const jobCategory = application?.job?.jobCategory || 'Other';
      if (!categoryStats.has(jobCategory)) {
        categoryStats.set(jobCategory, {
          category: jobCategory,
          applications: 0,
          placements: 0,
          successRate: 0,
        });
      }

      const row = categoryStats.get(jobCategory);
      row.applications += 1;
      if (['Accepted', 'Approved', 'Hired'].includes(String(application.status || ''))) {
        row.placements += 1;
      }
    });

    const result = Array.from(categoryStats.values()).map((category) => ({
      ...category,
      successRate: category.applications > 0
        ? Math.round((category.placements / category.applications) * 1000) / 10
        : 0,
    }));

    return result;

  } catch (error) {
    console.error('Error getting job category breakdown:', error);
    return [];
  }
};

const aggregateAnalyticsData = (data, period) => {
  try {
    if (!data || !Array.isArray(data)) {
      return [];
    }

    const groupedData = {};
    
    data.forEach(record => {
      if (!record || !record.date) return;
      
      let key;
      const date = new Date(record.date);
      
      switch (period) {
        case 'daily':
          key = date.toISOString().split('T')[0];
          break;
        case 'weekly':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        case 'monthly':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        default:
          key = date.toISOString().split('T')[0];
      }
      
      if (!groupedData[key]) {
        groupedData[key] = {
          period: key,
          candidateMetrics: {
            totalManaged: 0,
            newCandidates: 0,
            successfulPlacements: 0
          },
          applicationMetrics: {
            totalApplications: 0,
            pendingApplications: 0,
            approvedApplications: 0,
            rejectedApplications: 0
          },
          performanceMetrics: {
            placementSuccessRate: 0
          }
        };
      }
      
      // Safely aggregate the data
      if (record.candidateMetrics) {
        groupedData[key].candidateMetrics.totalManaged += record.candidateMetrics.totalManaged || 0;
        groupedData[key].candidateMetrics.newCandidates += record.candidateMetrics.newCandidates || 0;
        groupedData[key].candidateMetrics.successfulPlacements += record.candidateMetrics.successfulPlacements || 0;
      }
      
      if (record.applicationMetrics) {
        groupedData[key].applicationMetrics.totalApplications += record.applicationMetrics.totalApplications || 0;
        groupedData[key].applicationMetrics.pendingApplications += record.applicationMetrics.pendingApplications || 0;
        groupedData[key].applicationMetrics.approvedApplications += record.applicationMetrics.approvedApplications || 0;
        groupedData[key].applicationMetrics.rejectedApplications += record.applicationMetrics.rejectedApplications || 0;
      }
    });
    
    // Calculate success rates
    Object.values(groupedData).forEach(group => {
      if (group.applicationMetrics.totalApplications > 0) {
        group.performanceMetrics.placementSuccessRate = 
          (group.applicationMetrics.approvedApplications / group.applicationMetrics.totalApplications) * 100;
      }
    });
    
    return Object.values(groupedData);

  } catch (error) {
    console.error('Error aggregating analytics data:', error);
    return [];
  }
};

const calculateGrowthPercentage = (oldValue, newValue) => {
  if (!oldValue || oldValue === 0) {
    return newValue > 0 ? 100 : 0;
  }
  return Math.round(((newValue - oldValue) / oldValue) * 100 * 100) / 100;
};

// Export analytics data (for reports)
const exportAnalytics = async (req, res) => {
  try {
    const agentId = req.user._id;
    const { startDate, endDate, format = 'json' } = req.query;
    
    // Verify user is an agent
    if (req.user.userType !== 'agent') {
      return res.status(403).json({
        success: false,
        message: 'Only agents can export analytics'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    const analyticsData = await AgentAnalytics.getAnalyticsRange(agentId, start, end);
    const agent = await User.findById(agentId).select('companyName contactPerson email');
    
    const exportData = {
      agent: {
        company: agent?.companyName || 'N/A',
        contact: agent?.contactPerson || 'N/A',
        email: agent?.email || 'N/A'
      },
      period: {
        startDate: start,
        endDate: end
      },
      summary: await calculateCurrentMetrics(agentId, agent || {}),
      detailedData: analyticsData || [],
      generatedAt: new Date()
    };

    if (format === 'csv') {
      const csv = convertToCSV(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="analytics_${agentId}_${Date.now()}.csv"`);
      return res.send(csv);
    }

    res.json({
      success: true,
      data: exportData
    });

  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting analytics data'
    });
  }
};

const convertToCSV = (data) => {
  try {
    const csvRows = [];
    
    // Headers
    csvRows.push('Date,Total Managed,New Candidates,Applications,Placements,Success Rate');
    
    // Data rows
    if (data.detailedData && Array.isArray(data.detailedData)) {
      data.detailedData.forEach(record => {
        const row = [
          record.date ? new Date(record.date).toISOString().split('T')[0] : '',
          record.candidateMetrics?.totalManaged || 0,
          record.candidateMetrics?.newCandidates || 0,
          record.applicationMetrics?.totalApplications || 0,
          record.candidateMetrics?.successfulPlacements || 0,
          record.performanceMetrics?.placementSuccessRate || 0
        ];
        csvRows.push(row.join(','));
      });
    }
    
    return csvRows.join('\n');
  } catch (error) {
    console.error('Error converting to CSV:', error);
    return 'Date,Total Managed,New Candidates,Applications,Placements,Success Rate\nNo data available';
  }
};

module.exports = {
  getAgentDashboardAnalytics,
  getDetailedAnalytics,
  updateAnalytics,
  exportAnalytics,
};
