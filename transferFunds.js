import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const INVOICES_FILE = path.join(__dirname, 'data', 'invoices.json');
const MASTER_WALLET = process.env.MASTER_LTC_ADDRESS;
const TATUM_API_KEY = process.env.TATUM_API_KEY;
const BLOCKCYPHER_TOKEN = process.env.BLOCKCYPHER_TOKEN;

async function readInvoicesData() {
  try {
    const data = await fs.readFile(INVOICES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { invoices: [] };
  }
}

async function writeInvoicesData(data) {
  await fs.writeFile(INVOICES_FILE, JSON.stringify(data, null, 2));
}

async function checkBalance(address) {
  try {
    const response = await axios.get(
      `https://api.blockcypher.com/v1/ltc/main/addrs/${address}/balance?token=${BLOCKCYPHER_TOKEN}`
    );
    const balance = response.data.balance / 100000000; // Convert from satoshis
    return balance;
  } catch (error) {
    console.error(`Error checking balance for ${address}:`, error.message);
    return 0;
  }
}

async function forwardFunds(fromAddress, privateKey, wifKey, amount) {
  try {
    if (!MASTER_WALLET) {
      console.log('No master wallet configured');
      return null;
    }

    // Calculate amount to send (leave some for fees)
    const percentageFee = amount * 0.02; // 2%
    const minimumFee = 0.0001; // 0.0001 LTC minimum
    const fee = Math.max(percentageFee, minimumFee);
    const amountToSend = (amount - fee).toFixed(8);

    if (parseFloat(amountToSend) <= 0) {
      console.log(`Amount too small to forward: ${amount} LTC`);
      return null;
    }

    console.log(`Forwarding ${amountToSend} LTC from ${fromAddress} to ${MASTER_WALLET}`);

    // Use Tatum API to send transaction - use WIF key (52 chars) not hex private key (64 chars)
    const txData = {
      fromAddress: [
        {
          address: fromAddress,
          privateKey: wifKey || privateKey // Use WIF if available, fallback to hex
        }
      ],
      to: [
        {
          address: MASTER_WALLET,
          value: parseFloat(amountToSend)
        }
      ]
    };

    const response = await axios.post(
      'https://api.tatum.io/v3/litecoin/transaction',
      txData,
      {
        headers: {
          'x-api-key': TATUM_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`Funds forwarded! TX ID: ${response.data.txId}`);
    return response.data.txId;
  } catch (error) {
    console.error(`Error forwarding funds from ${fromAddress}:`, error.response?.data || error.message);
    return null;
  }
}

async function transferAllFunds() {
  console.log('Starting fund transfer process...');
  
  const data = await readInvoicesData();
  const invoices = data.invoices || [];
  
  console.log(`Found ${invoices.length} invoices`);
  
  let totalTransferred = 0;
  let successfulTransfers = 0;
  let failedTransfers = 0;
  
  for (const invoice of invoices) {
    if (invoice.cryptoAddress && invoice.cryptoPrivateKey) {
      console.log(`\nProcessing invoice ${invoice._id}...`);
      console.log(`Address: ${invoice.cryptoAddress}`);
      
      // Check current balance
      const balance = await checkBalance(invoice.cryptoAddress);
      console.log(`Current balance: ${balance} LTC`);
      
      if (balance > 0.0001) { // Only transfer if there's enough for fees
        const txId = await forwardFunds(
          invoice.cryptoAddress, 
          invoice.cryptoPrivateKey, 
          invoice.cryptoWif, // Pass WIF key
          balance
        );
        
        if (txId) {
          totalTransferred += balance;
          successfulTransfers++;
          console.log(`✅ Successfully transferred ${balance} LTC`);
        } else {
          failedTransfers++;
          console.log(`❌ Failed to transfer funds`);
        }
      } else {
        console.log(`⚠️ Balance too low to transfer (${balance} LTC)`);
      }
    }
  }
  
  console.log('\n=== Transfer Summary ===');
  console.log(`Total invoices processed: ${invoices.length}`);
  console.log(`Successful transfers: ${successfulTransfers}`);
  console.log(`Failed transfers: ${failedTransfers}`);
  console.log(`Total LTC transferred: ${totalTransferred.toFixed(8)}`);
  console.log('========================');
}

// Run the transfer
transferAllFunds().catch(console.error);