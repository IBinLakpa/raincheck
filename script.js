$(document).ready(function() {
    // Initialize date picker
    $('.datePicker').datepicker({
        format: "yyyy-mm-dd",
        autoclose: true
    });

    // Function to get Nepal time (GMT +5:45)
    function getNepalTime(offsetMinutes) {
        let now = new Date();
        let utc = now.getTime() + (now.getTimezoneOffset() * 60000); 
        return new Date(utc + (offsetMinutes * 60000));
    }

    let nepalTimeToday = getNepalTime(345);
    $('#date_from').val(nepalTimeToday.toISOString().split('T')[0]);
    $('#date_to').val(nepalTimeToday.toISOString().split('T')[0]);

    // Fetch stations and populate basin and station dropdowns
    function loadStations() {
        $.ajax({
            url: 'https://www.dhm.gov.np/frontend_dhm/hydrology/getRainfallFilter',
            type: 'GET',
            dataType: 'json',
            success: function(response) {
                var basinSelect = $('#basin');
                var stationSelect = $('#station');
                var stations = response.data[0]; 

                // Find unique basins
                var basins = [...new Set(stations.map(station => station.basin))];

                // Populate basin dropdown
                basinSelect.empty();
                basinSelect.append('<option value="">All Basins</option>');
                basins.forEach(function(basin) {
                    basinSelect.append('<option value="' + basin + '">' + basin + '</option>');
                });

                // Populate station dropdown
                function populateStations(stationsList) {
                    stationSelect.empty();
                    stationSelect.append('<option value="all">All Stations</option>');
                    stationsList.forEach(function(station) {
                        stationSelect.append('<option value="' + station.series_id + '">' + station.name + '</option>');
                    });
                }

                populateStations(stations);

                // Filter stations by selected basin
                basinSelect.on('change', function() {
                    var selectedBasin = $(this).val();
                    if (selectedBasin) {
                        var filteredStations = stations.filter(station => station.basin === selectedBasin);
                        populateStations(filteredStations);
                    } else {
                        populateStations(stations);
                    }
                });
            },
            error: function() {
                $('#basin').html('<option value="">Failed to load basins</option>');
                $('#station').html('<option value="">Failed to load stations</option>');
            }
        });
    }

    // Load stations on page load
    loadStations();

    // Initialize global object to store CSV data by station
    let stationCsvData = {};

    // Form submission
    $('#rainfallForm').on('submit', function(e) {
        e.preventDefault();

        let selectedStation = $('#station').val();
        let dateFrom = $('#date_from').val();
        let dateTo = $('#date_to').val();
        stationCsvData = {}; // Reset station data

        if (new Date(dateFrom) > new Date(dateTo)) {
            $('#output').html('<p>Invalid date range.</p>');
            return;
        }

        // Get date range
        let dates = getDatesInRange(dateFrom, dateTo);

        // Show spinner, hide download button
        $('#spinner').show();
        $('#downloadButton').hide();

        let requests = [];

        if (selectedStation === "all") {
            $('#station option').each(function() {
                let stationId = $(this).val();
                let stationName = $(this).text();
                if (stationId !== "all") {
                    dates.forEach(date => {
                        requests.push(collectDataForStation(stationId, stationName, date, dateFrom, dateTo));
                    });
                }
            });
        } else {
            let stationName = $('#station option:selected').text();
            dates.forEach(date => {
                requests.push(collectDataForStation(selectedStation, stationName, date, dateFrom, dateTo));
            });
        }

        // Wait for all requests to complete
        Promise.all(requests).then(() => {
            // After all data is collected, download files
            $('#downloadButton').show();
            $('#downloadButton').on('click', function() {
                triggerCsvOrZipDownload(stationCsvData);
            });
        }).finally(() => {
            $('#spinner').hide();
        });
    });

    function collectDataForStation(stationId, stationName, date, dateFrom, dateTo) {
        return new Promise((resolve, reject) => {
            $.ajax({
                type: 'POST',
                url: 'https://www.dhm.gov.np/hydrology/getRainfallWatchBySeriesId',
                data: { date, period: 2, seriesid: stationId },
                success: function(response) {
                    let tableHTML = JSON.parse(response).data.table;
                    let tempDiv = $('<div>').html(tableHTML);

                    tempDiv.find('tbody tr').each(function() {
                        let dateText = $(this).find('td').eq(0).text().trim();
                        let point = $(this).find('td').eq(1).text().trim();

                        let dateObj = new Date(dateText);
                        let day = ("0" + dateObj.getDate()).slice(-2);
                        let month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
                        let year = dateObj.getFullYear();
                        let hours = ("0" + dateObj.getHours()).slice(-2);

                        let csvRow = `${day}${month}${year},${hours},${point}`;

                        // Only compare the date part (ignore time)
                        let dateOnlyObj = new Date(dateObj);
                        let dateOnlyFrom = new Date(dateFrom);
                        let dateOnlyTo = new Date(dateTo);

                        dateOnlyObj.setHours(0, 0, 0, 0); // Reset time to midnight
                        dateOnlyFrom.setHours(0, 0, 0, 0); // Reset time to midnight
                        dateOnlyTo.setHours(0, 0, 0, 0); // Reset time to midnight

                        // Add data to the corresponding station's CSV data
                        if (!stationCsvData[stationName]) {
                            stationCsvData[stationName] = [];
                        }
                        if (dateOnlyFrom <= dateOnlyObj && dateOnlyObj <= dateOnlyTo){
                            stationCsvData[stationName].push(csvRow);
                        }
                    });

                    resolve();
                },
                error: function() {
                    $('#output').append('<p>Failed to retrieve data for ' + stationName + ' on ' + date + '.</p>');
                    resolve();
                }
            });
        });
    }

    // Trigger CSV or ZIP download depending on the number of stations
    function triggerCsvOrZipDownload(stationCsvData) {
        let stationNames = Object.keys(stationCsvData);

        if (stationNames.length === 1) {
            triggerCsvDownload(stationNames[0], stationCsvData[stationNames[0]]);
        } else {
            triggerZipDownload(stationCsvData);
        }

    }

    //Sort the CSV data by date and time
    function sortCSV(csvData){
        csvData.sort((a, b) => {
            // Split the rows by commas to extract date and time
            let [dateA, timeA] = a.split(',').slice(0, 2); 
            let [dateB, timeB] = b.split(',').slice(0, 2); 
            
            // Convert dates from ddmmyyyy to yyyy-mm-dd for comparison
            let formattedDateA = `${dateA.slice(4, 8)}-${dateA.slice(2, 4)}-${dateA.slice(0, 2)}`;
            let formattedDateB = `${dateB.slice(4, 8)}-${dateB.slice(2, 4)}-${dateB.slice(0, 2)}`;
            
            // Create Date objects with time for comparison
            let dateTimeA = new Date(`${formattedDateA}T${timeA.slice(0, 2)}:${timeA.slice(2, 4)}`);
            let dateTimeB = new Date(`${formattedDateB}T${timeB.slice(0, 2)}:${timeB.slice(2, 4)}`);
            
            // Compare the two Date objects
            return dateTimeA - dateTimeB;
        });
        return csvData
    }

    // Download a single CSV file
    function triggerCsvDownload(stationName, csvData) {
        let sortedCSVdata = sortCSV(csvData);
        let csvString = 'Date,Time,Point\n' + sortedCSVdata.join('\n');
        let blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        let link = document.createElement('a');
        let url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', stationName + '_rainfall_data.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // Create and download a ZIP file containing multiple CSV files
    function triggerZipDownload(stationCsvData) {
        let zip = new JSZip();
        Object.keys(stationCsvData).forEach(stationName => {
            let csvData = sortCSV(stationCsvData[stationName]);
            let csvString = 'Date,Time,Point\n' + csvData.join('\n');
            zip.file(stationName + '_rainfall_data.csv', csvString);
        });

        zip.generateAsync({ type: 'blob' }).then(function(content) {
            let link = document.createElement('a');
            let url = URL.createObjectURL(content);

            link.setAttribute('href', url);
            link.setAttribute('download', 'rainfall_data.zip');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        });
    }

    // Get all dates in a range
    function getDatesInRange(startDate, endDate) {
        let dates = [];
        let currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() - 1);

        while (currentDate <= new Date(endDate)) {
            dates.push(currentDate.toISOString().split('T')[0]);
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return dates;
    }
});
