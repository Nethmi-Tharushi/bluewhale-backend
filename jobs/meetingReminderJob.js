const cron = require('node-cron');
const Meeting = require('../models/Meeting');
const User = require('../models/User');
const { sendMeetingReminderEmail } = require('../services/emailService');

cron.schedule('*/5 * * * *', async () => {
  try {
    const now = new Date();
    const reminderWindowMinutes = 60;
    const reminderTime = new Date(now.getTime() + reminderWindowMinutes * 60 * 1000);

    console.log(`[MeetingReminderJob] Checking for meetings between ${now.toISOString()} and ${reminderTime.toISOString()}`);

    const meetings = await Meeting.find({
      date: { 
        $gte: now, 
        $lte: reminderTime 
      },
      status: 'Scheduled',
      reminderSent: false,
    })
    .populate('candidate', 'name email userType') // Only basic fields first
    .populate('salesAdmin', 'name email')
    .populate('mainAdmin', 'name email');

    if (!meetings.length) {
      console.log('[MeetingReminderJob] No meetings found for reminder.');
      return;
    }

    console.log(`[MeetingReminderJob] Found ${meetings.length} meetings for reminders`);

    for (const meeting of meetings) {
      console.log(`[MeetingReminderJob] Processing meeting "${meeting.title}" at ${meeting.date.toISOString()}`);
      console.log(`[MeetingReminderJob] Meeting candidateType: ${meeting.candidateType}, managedCandidateId: ${meeting.managedCandidateId}`);

      let users = [];

      // Handle B2B managed candidate meetings
      if (meeting.candidateType === 'B2B' && meeting.managedCandidateId) {
        console.log(`[MeetingReminderJob] This is a B2B meeting`);
        
        // For B2B, we need to find the agent who owns this managed candidate
        const agent = await User.findOne({
          'managedCandidates._id': meeting.managedCandidateId
        }).select('name email managedCandidates');

        console.log(`[MeetingReminderJob] Agent found:`, agent?.name, agent?.email);
        
        if (agent) {
          const managedCandidate = agent.managedCandidates.id(meeting.managedCandidateId);
          console.log(`[MeetingReminderJob] Managed candidate found:`, managedCandidate?.name);
          
          if (agent.email) {
            users.push({ 
              name: agent.name, 
              email: agent.email,
              type: 'agent',
              managedCandidateName: managedCandidate?.name || 'Managed Candidate'
            });
            console.log(`[MeetingReminderJob] Added agent to recipients: ${agent.email}`);
          } else {
            console.log(`[MeetingReminderJob] Agent has no email address`);
          }
        } else {
          console.log(`[MeetingReminderJob] No agent found for managed candidate ID: ${meeting.managedCandidateId}`);
        }
      } else {
        // For B2C meetings
        console.log(`[MeetingReminderJob] This is a B2C meeting`);
        if (meeting.candidate?.email) {
          users.push({ 
            name: meeting.candidate.name, 
            email: meeting.candidate.email,
            type: 'candidate'
          });
          console.log(`[MeetingReminderJob] Added candidate to recipients: ${meeting.candidate.email}`);
        }
      }

      // Add admins
      if (meeting.salesAdmin?.email) {
        users.push({ 
          name: meeting.salesAdmin.name, 
          email: meeting.salesAdmin.email,
          type: 'salesAdmin'
        });
        console.log(`[MeetingReminderJob] Added sales admin to recipients: ${meeting.salesAdmin.email}`);
      }
      if (meeting.mainAdmin?.email) {
        users.push({ 
          name: meeting.mainAdmin.name, 
          email: meeting.mainAdmin.email,
          type: 'mainAdmin'
        });
        console.log(`[MeetingReminderJob] Added main admin to recipients: ${meeting.mainAdmin.email}`);
      }

      console.log(`[MeetingReminderJob] Final recipients: ${users.map(u => `${u.email} (${u.type})`).join(', ')}`);

      let allEmailsSuccessful = true;

      // Send emails to all users
      for (const user of users) {
        if (user.email) {
          try {
            await sendMeetingReminderEmail(user, meeting);
            console.log(`[MeetingReminderJob]  Email sent to ${user.email} (${user.type})`);
          } catch (emailError) {
            console.error(`[MeetingReminderJob]  Failed to send email to ${user.email}:`, emailError.message);
            allEmailsSuccessful = false;
          }
        }
      }

      // Mark as sent regardless of email failures to prevent duplicates
      meeting.reminderSent = true;
      await meeting.save();
      console.log(`[MeetingReminderJob] 📝 Reminder marked as sent for meeting "${meeting.title}"`);
    }

    console.log(`[MeetingReminderJob] ${meetings.length} meeting reminders processed at ${now.toISOString()}`);
  } catch (error) {
    console.error('[MeetingReminderJob] Error in cron job:', error);
  }
});