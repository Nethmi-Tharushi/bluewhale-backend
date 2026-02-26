const mongoose = require('mongoose');
const Job = require('./models/Job'); // adjust path if needed
require('dotenv').config();

const ADMIN_ID = '688b4d1260b37332165e8d43';

const jobs = [
  {
    title: 'Frontend Developer',
    company: 'Tech Solutions',
    location: 'Colombo',
    tags: ["Latest", "Featured"],
    country: 'Sri Lanka',
    type: 'Full-time',
    description: 'Join our dynamic team as a Frontend Developer where you will be responsible for building and maintaining high-quality web applications using modern technologies. You will collaborate with cross-functional teams including designers, backend developers, and product managers to create seamless user experiences. Your role will involve translating UI/UX design wireframes into actual code, optimizing applications for maximum speed and scalability, and ensuring the technical feasibility of designs. The ideal candidate will have a strong understanding of web markup, including HTML5 and CSS3, and extensive experience with client-side scripting and JavaScript frameworks, especially React.',
    benefits: [
      'Comprehensive health insurance including dental and vision coverage',
      'Generous paid time off policy with 25 days annual leave',
      'Flexible working hours and remote work options',
      'Professional development budget of $2,000 per year',
    ],
    requirements: [
      'Minimum 3+ years of professional experience in frontend development',
      'Strong proficiency in JavaScript, including DOM manipulation and the JavaScript object model',
      'Thorough understanding of React.js and its core principles',
      'Experience with popular React.js workflows (such as Flux or Redux)',
    ],
    skills: ['JavaScript', 'React', 'CSS', 'HTML5', 'Redux', 'Webpack', 'Git', 'REST APIs'],
    salary: 120000,
    pricing: {
      currency: 'USD',
      candidatePrice: 120000,
      agentPrice: 150000,
    },
    postedBy: ADMIN_ID,
    ageLimit: { min: 20, max: 35 },
    postedAt: new Date(),
    expiringAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  },
  {
    title: 'Backend Developer',
    company: 'Innovative Tech',
    location: 'New York',
    tags: ["Urgent", "Featured"],
    country: 'USA',
    type: 'Full-time',
    description: 'We are seeking a skilled Backend Developer to join our growing engineering team. In this role, you will be responsible for designing, developing, and maintaining server-side logic, databases, and APIs for our web applications. You will work closely with frontend developers to integrate user-facing elements with server-side logic, implement security and data protection measures, and optimize applications for maximum speed and scalability. The ideal candidate will have extensive experience with Node.js, Express, and MongoDB, and a strong understanding of the fundamental design principles behind scalable applications.',
    benefits: [
      'Competitive salary with biannual performance reviews',
      'Full health, dental, and vision insurance coverage',
      'Unlimited PTO policy with mandatory minimum time off',
      'Flexible work arrangements including remote options',
    ],
    requirements: [
      '4+ years of professional backend development experience',
      'Strong proficiency with JavaScript and Node.js',
      'Extensive experience with Express.js or similar frameworks',
      'In-depth knowledge of MongoDB and database design principles',
    ],
    skills: ['Node.js', 'Express', 'MongoDB', 'REST APIs', 'AWS', 'Docker', 'Git', 'JavaScript'],
    salary: 130000,
    pricing: {
      currency: 'USD',
      candidatePrice: 130000,
      agentPrice: 160000,
    },
    postedBy: ADMIN_ID,
    ageLimit: { min: 22, max: 40 },
    postedAt: new Date(),
    expiringAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  },
  {
    title: 'Data Scientist',
    company: 'Analytics Hub',
    location: 'London',
    country: 'UK',
    type: 'Full-time',
    description: 'Join our elite data science team as we transform raw data into actionable insights that drive business decisions. As a Data Scientist, you will be responsible for analyzing large datasets, developing machine learning models, and creating data-driven solutions to complex business problems. You will work closely with stakeholders across the organization to understand their needs and deliver innovative analytical solutions. The ideal candidate will have a strong foundation in statistics, machine learning, and programming, with experience in Python, R, and SQL.',
    benefits: [
      'Competitive salary with performance-based bonuses',
      'Private health insurance including mental health support',
      '30 days annual leave plus public holidays',
      'Flexible working arrangements with remote options',
    ],
    requirements: [
      'Master\'s or PhD in Computer Science, Statistics, Mathematics, or related field',
      '5+ years of experience in data science or machine learning roles',
      'Strong programming skills in Python and experience with data science libraries (Pandas, NumPy, Scikit-learn)',
    ],
    skills: ['Python', 'Machine Learning', 'SQL', 'Statistics', 'Data Visualization', 'TensorFlow', 'AWS', 'Big Data'],
    salary: 150000,
    pricing: {
      currency: 'USD',
      candidatePrice: 150000,
      agentPrice: 180000,
    },
    postedBy: ADMIN_ID,
    ageLimit: { min: 23, max: 40 },
    postedAt: new Date(),
    expiringAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
  },
  {
    title: 'Marketing Manager',
    company: 'SalesPro',
    location: 'Sydney',
    tags: ["Featured"],
    country: 'Australia',
    type: 'Full-time',
    description: 'We are looking for an experienced Marketing Manager to develop and implement strategic marketing plans that will enhance our brand presence and drive customer acquisition. In this role, you will lead a team of marketing professionals, oversee campaign execution, analyze market trends, and collaborate with sales and product teams to achieve business objectives. The ideal candidate will have a proven track record in developing successful marketing strategies, strong leadership skills, and expertise in digital marketing channels including SEO, SEM, social media, and email marketing.',
    benefits: [
      'Attractive remuneration package with performance bonuses',
      'Comprehensive health and wellness program',
      'Flexible working arrangements with work-from-home options',
      'Professional development allowance of AUD 3,000 per year',
    ],
    requirements: [
      'Bachelor\'s degree in Marketing, Business, or related field; MBA preferred',
      '7+ years of experience in marketing with at least 3 years in a management role',
      'Proven experience developing marketing strategies and campaigns',
      'Strong knowledge of various marketing channels including digital and traditional',
    ],
    skills: ['SEO', 'Leadership', 'Content Marketing', 'Digital Strategy', 'Analytics', 'Team Management', 'Budgeting', 'CRM'],
    salary: 140000,
    pricing: {
      currency: 'AUD',
      candidatePrice: 140000,
      agentPrice: 170000,
    },
    postedBy: ADMIN_ID,
    ageLimit: { min: 25, max: 45 },
    postedAt: new Date(),
    expiringAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
  },
  {
    title: 'UI/UX Designer',
    company: 'Creative Minds',
    location: 'Toronto',
    country: 'Canada',
    type: 'Contract',
    description: 'Join our design team as a UI/UX Designer and play a key role in creating intuitive and visually appealing user experiences for our digital products. You will be responsible for conducting user research, creating user personas, designing wireframes and prototypes, and collaborating with developers to implement your designs. The ideal candidate will have a strong portfolio demonstrating expertise in user-centered design principles, proficiency with design tools such as Figma and Adobe XD, and experience working in agile development environments.',
    benefits: [
      'Competitive hourly rate with potential for contract extension',
      'Flexible schedule and remote work options',
      'Access to latest design tools and software',
    ],
    requirements: [
      '3+ years of professional experience in UI/UX design',
      'Strong portfolio demonstrating design thinking and problem-solving skills',
      'Proficiency in design tools such as Figma, Adobe XD, Sketch, or similar',
      'Experience creating wireframes, storyboards, user flows, and prototypes',
    ],
    skills: ['Figma', 'Adobe XD', 'User Research', 'Wireframing', 'Prototyping', 'Visual Design', 'Usability Testing', 'Design Thinking'],
    salary: 90000,
    pricing: {
      currency: 'INR',
      candidatePrice: 90000,
      agentPrice: 110000,
    },
    postedBy: ADMIN_ID,
    ageLimit: { min: 20, max: 35 },
    postedAt: new Date(),
    expiringAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
  },
  {
    title: 'HR Executive',
    company: 'PeopleFirst',
    location: 'Singapore',
    tags: ["Latest"],
    country: 'Singapore',
    type: 'Full-time',
    description: 'We are seeking an experienced HR Executive to join our human resources team. In this role, you will be responsible for managing various HR functions including recruitment, employee relations, performance management, and HR administration. You will serve as a point of contact for employees regarding HR-related queries, assist in developing and implementing HR policies and procedures, and support the overall HR strategy of the organization. The ideal candidate will have strong interpersonal skills, knowledge of employment laws, and experience in multiple HR disciplines.',
    benefits: [
      'Competitive salary with annual performance bonus',
      'Comprehensive medical insurance coverage',
      '20 days annual leave plus public holidays',
      'Flexible work arrangements',
    ],
    requirements: [
      'Bachelor\'s degree in Human Resources, Business Administration, or related field',
      '3+ years of experience in human resources roles',
      'Knowledge of HR systems and databases',
      'In-depth knowledge of labor law and HR best practices',
    ],
    skills: ['Recruitment', 'Employee Relations', 'Communication', 'HR Policies', 'Performance Management', 'Conflict Resolution', 'HRIS', 'Labor Law'],
    salary: 90000,
    pricing: {
      currency: 'USD',
      candidatePrice: 90000,
      agentPrice: 110000,
    },
    postedBy: ADMIN_ID,
    ageLimit: { min: 22, max: 40 },
    postedAt: new Date(),
    expiringAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
  },
  {
    title: 'Graphic Designer',
    company: 'Design Studio',
    location: 'Berlin',
    country: 'Germany',
    type: 'Contract',
    description: 'Join our creative team as a Graphic Designer and work on a variety of projects including branding, marketing materials, digital assets, and more. You will collaborate with clients and team members to create visually compelling designs that communicate effectively and align with brand guidelines. The ideal candidate will have a strong portfolio showcasing a range of design work, proficiency in Adobe Creative Suite, and the ability to work efficiently in a fast-paced environment.',
    benefits: [
      'Competitive project-based compensation',
      'Flexible working hours and remote options',
      'Creative freedom and diverse projects',
      'Portfolio expansion with notable clients',
    ],
    requirements: [
      '3+ years of professional graphic design experience',
      'Strong portfolio demonstrating creative skills and design thinking',
      'Expert knowledge of Adobe Creative Suite (Photoshop, Illustrator, InDesign)',
      'Experience with branding, layout, color theory, and typography',
      'Knowledge of prepress and print production processes',
    ],
    skills: ['Photoshop', 'Illustrator', 'Creativity', 'Typography', 'Branding', 'Layout Design', 'Print Production', 'Digital Design'],
    salary: 80000,
    pricing: {
      currency: 'EUR',
      candidatePrice: 80000,
      agentPrice: 95000,
    },
    postedBy: ADMIN_ID,
    ageLimit: { min: 20, max: 35 },
    postedAt: new Date(),
    expiringAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
  },
  {
    title: 'Remote Content Writer',
    company: 'WriteAway',
    location: 'Remote',
    country: 'USA',
    type: 'Remote',
    description: 'We are looking for a talented Remote Content Writer to create engaging and informative content for our various digital platforms. You will be responsible for researching topics, writing articles, blog posts, social media content, and other marketing materials. The ideal candidate will have excellent writing skills, the ability to adapt to different tones and styles, and experience with SEO best practices. This is a fully remote position, offering flexibility and the opportunity to work with a diverse team from around the world.',
    benefits: [
      'Fully remote work with flexible schedule',
      'Competitive per-word or per-project rates',
      'Consistent workflow and long-term projects',
      'Creative freedom within project guidelines',
    ],
    requirements: [
      '2+ years of professional content writing experience',
      'Exceptional writing, editing, and proofreading skills',
      'Ability to write in different styles and tones for various audiences',
      'Knowledge of SEO principles and best practices',
    ],
    skills: ['SEO', 'Content Writing', 'Research', 'Editing', 'WordPress', 'Keyword Research', 'Copywriting', 'Proofreading'],
    salary: 50000,
    pricing: {
      currency: 'USD',
      candidatePrice: 50000,
      agentPrice: 65000,
    },
    postedBy: ADMIN_ID,
    ageLimit: { min: 18, max: 35 },
    postedAt: new Date(),
    expiringAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
  },
  {
    title: 'Project Manager',
    company: 'BuildIt Ltd.',
    location: 'Dubai',
    country: 'UAE',
    type: 'Full-time',
    description: 'Join our team as a Project Manager and lead exciting construction and development projects from conception to completion. You will be responsible for planning, executing, and finalizing projects according to strict deadlines and within budget. This includes acquiring resources and coordinating the efforts of team members and third-party contractors or consultants to deliver projects according to plan. The ideal candidate will have extensive experience in project management, strong leadership skills, and knowledge of construction processes and regulations.',
    benefits: [
      'Tax-free salary with performance bonuses',
      'Housing allowance or company-provided accommodation',
      'Annual flight allowance to home country',
      'Comprehensive health insurance for employee and family',
    ],
    requirements: [
      'Bachelor\'s degree in Engineering, Construction Management, or related field',
      '8+ years of experience in project management, preferably in construction',
      'PMP, PRINCE2, or similar project management certification',
      'Proven experience in managing large-scale projects from start to finish',
    ],
    skills: ['Leadership', 'Communication', 'Planning', 'Budgeting', 'Risk Management', 'Construction', 'Stakeholder Management', 'Project Management Software'],
    salary: 150000,
    pricing: {
      currency: 'AED',
      candidatePrice: 150000,
      agentPrice: 180000,
    },
    postedBy: ADMIN_ID,
    ageLimit: { min: 25, max: 45 },
    postedAt: new Date(),
    expiringAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
  },
  {
    title: 'Intern – Software Development',
    company: 'NextGen Labs',
    location: 'Bangalore',
    country: 'India',
    type: 'Internship',
    description: 'We are offering an exciting internship opportunity for aspiring software developers to gain hands-on experience in a professional environment. As a Software Development Intern, you will work alongside experienced developers on real projects, participate in code reviews, and contribute to the development of software solutions. This internship is designed to provide valuable learning experiences, mentorship, and the opportunity to develop practical skills that will prepare you for a successful career in software development.',
    benefits: [
      'Monthly stipend and performance incentives',
      'Hands-on experience with real projects',
      'Mentorship from experienced developers',
      'Flexible hours to accommodate academic schedule',
    ],
    requirements: [
      'Currently pursuing a degree in Computer Science, IT, or related field',
      'Basic knowledge of programming languages such as Python, Java, or JavaScript',
      'Understanding of fundamental programming concepts',
    ],
    skills: ['Python', 'JavaScript', 'Git', 'Problem Solving', 'Teamwork', 'Learning Agility', 'Communication', 'Software Development Basics'],
    salary: 20000,
    pricing: {
      currency: 'INR',
      candidatePrice: 20000,
      agentPrice: 25000,
    },
    postedBy: ADMIN_ID,
    ageLimit: { min: 18, max: 25 },
    postedAt: new Date(),
    expiringAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
  },
];

const seedJobs = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    await Job.deleteMany({});
    console.log('Existing jobs removed');

    await Job.insertMany(jobs);
    console.log('Jobs seeded successfully');

    process.exit();
  } catch (error) {
    console.error('Error seeding jobs:', error);
    process.exit(1);
  }
};

seedJobs();
