Postmaster Insights (Node.js Version)
This application provides a web interface to visualize data from the Google Postmaster Tools API, helping you monitor domain reputation, IP reputation, spam rates, and other email delivery metrics. This version is built with Node.js and Express.
Prerequisites
Before you begin, ensure you have the following installed on your system:
* Node.js: Download & Install Node.js (which includes npm).
* A Google Account: To access the Google Cloud Console and Postmaster Tools.
Setup Instructions
Follow these steps to get the application running on your local machine.
Step 1: Get the Project Files
Download all the project files (server.js, postmaster-api.js, package.json, and the views directory with its .ejs files) and place them together in a new project folder.
Step 2: Install Dependencies
Open a terminal or command prompt, navigate to your project folder, and run the following command to install the necessary libraries listed in package.json:
npm install

Step 3: Obtain Google API Credentials
The application requires OAuth 2.0 credentials to access the Postmaster Tools API on your behalf.
1. Go to the Google Cloud Console: Navigate to the Google Cloud Console.
2. Create a New Project: If you don't have one already, create a new project.
3. Enable the API:
   * Go to APIs & Services > Library.
   * Search for "Gmail Postmaster Tools API" and click on it.
   * Click the Enable button.
4. Configure OAuth Consent Screen:
   * Go to APIs & Services > OAuth consent screen.
   * Choose External and click Create.
   * Fill in the required fields:
      * App name: Postmaster Insights (or any name you prefer).
      * User support email: Select your email address.
      * Developer contact information: Enter your email address.
   * Click Save and Continue. On the "Scopes" and "Test users" pages, you can just click Save and Continue without adding anything. Finally, click Back to Dashboard.
5. Create Credentials:
   * Go to APIs & Services > Credentials.
   * Click + Create Credentials and select OAuth client ID.
   * For Application type, select Web application.
   * Give it a name, like Postmaster Web Client.
   * Under Authorized redirect URIs, click + ADD URI and enter the following URL:
http://localhost:3000/oauth2callback

   * Click Create.
   6. Download the JSON File:
   * A popup will appear showing your Client ID and Client Secret.
   * Click the DOWNLOAD JSON button.
   * Rename the downloaded file to client_secret.json.
Step 4: Place the Credentials File
Move the client_secret.json file you just downloaded into the root directory of your project folder. This is the same folder that contains server.js and package.json.
Running the Application
   1. Start the Server: In your terminal, from the project's root directory, run:
npm start

You should see a message confirming that the server is running on http://localhost:3000.
   2. Open in Browser: Open a web browser and navigate to http://localhost:3000.
   3. First-Time Login:
      * The login page will prompt you to load your credentials. Click the Load Credentials File button. This reads the client_secret.json file into your session.
      * Once loaded, the Sign In with Google button will appear. Click it to go through the standard Google authentication flow.
      * After granting permission, you will be redirected back to the application and logged in.
How to Use the Application
      * Custom Domain Watchlist: The default page where you can enter a list of your verified domains to monitor their metrics over a selected date range.
      * Single Domain Dashboard: Click on any domain name in the custom list table (or navigate to /domain) to see a more detailed, chart-based view for a single domain.
File Structure
      * package.json: Defines the project dependencies and start script.
      * server.js: The main Express server file that handles routing, authentication, and API endpoints.
      * postmaster-api.js: A module that encapsulates all logic for making calls to the Google Postmaster Tools API.
      * views/: A directory containing the EJS template files for the web pages.
      * login.ejs: The login page.
      * custom_list.ejs: The dashboard for monitoring multiple domains.
      * single_domain.ejs: The detailed dashboard for a single domain.
      * client_secret.json: (You provide this) Your private credentials for accessing the Google API.